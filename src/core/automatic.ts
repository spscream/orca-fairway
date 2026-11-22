import { digest, Engine } from './engine.ts'
import { record, requireThat } from './config.ts'
import { Workflows, type AutomaticReason, type AutomaticState, type Workflow } from './workflow.ts'
import type { Runtime, Store, Workspace } from './types.ts'
interface Active { id: string; workspace: Workspace }
/** One explicitly authorized graph; one in-flight executor; no retries after uncertain dispatch. */
export class Automatic {
  private tail: Promise<unknown> = Promise.resolve()
  private stopped = false
  private controller: AbortController | null = null
  private planId: string | null = null
  constructor(private store: Store, private flows: Workflows, private engine: Engine, private runtime: Runtime, private now = Date.now) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.tail.then(fn, fn); this.tail = p.catch(() => {}); return p }
  async active(): Promise<Active | null> {
    const active = await this.store.get('automaticActive')
    if (!active) return null
    requireThat(record(active) && typeof active.id === 'string' && /^[0-9a-f-]{36}$/.test(active.id) && record(active.workspace) && active.workspace.host === 'local' && typeof active.workspace.id === 'string' && typeof active.workspace.path === 'string', 'invalid_automatic_state')
    return active as unknown as Active
  }
  private async mark(w: Workflow, state: AutomaticState['state'], reason: AutomaticReason | null): Promise<Workflow> {
    requireThat(w.automatic, 'invalid_automatic_state')
    return this.flows.automatic(w.id, w.workspace, { ...w.automatic, state, reason })
  }
  async recover(): Promise<void> {
    // Loading a plugin never starts an executor, even with persisted authorization.
    const active = await this.active()
    if (!active) return
    const w = await this.flows.get(active.id, active.workspace)
    if (!w.cancelled && w.automatic?.state === 'running') await this.mark(w, 'paused', 'interrupted')
  }
  start(id: string, workspace: Workspace): Promise<Workflow> {
    return this.serial(async () => {
      const previous = await this.active()
      if (previous && previous.id !== id) {
        const old = await this.flows.get(previous.id, previous.workspace)
        requireThat(old.cancelled || old.automatic?.state !== 'running', 'automatic_workflow_active')
      }
      const config = await this.engine.config(); requireThat(config.execution, 'execution_disabled')
      let w = await this.flows.get(id, workspace)
      requireThat(!w.cancelled && w.analysis, 'workflow_not_ready')
      requireThat(!Object.values(w.runs).some(r => ['dispatch_pending', 'dispatch_unknown', 'dispatch_failed'].includes(r.state)), 'workflow_running')
      if (!w.approvedHash) w = await this.flows.approve(id, workspace)
      requireThat(w.approvedHash === digest(w.analysis), 'workflow_not_ready')
      const remaining = w.analysis!.steps.filter(s => w.runs[s.id]?.state !== 'completed')
      requireThat(remaining.length > 0, 'workflow_not_ready')
      this.stopped = false
      await this.store.set('automaticActive', { id, workspace })
      w = await this.flows.automatic(id, workspace, { state: 'running', reason: null, configHash: digest(config), approvedHash: w.approvedHash!, expiresAt: this.now() + 2 * 60 * 60_000, dispatches: w.automatic?.dispatches ?? 0, limit: w.analysis!.steps.length })
      return w
    })
  }
  async pauseFor(id: string, workspace: Workspace): Promise<Workflow> {
    const active = await this.active()
    requireThat(active?.id === id && digest(active.workspace) === digest(workspace), 'workflow_workspace_changed')
    const paused = await this.pause(); requireThat(paused, 'workflow_not_ready'); return paused
  }
  async pause(reason: AutomaticReason = 'paused'): Promise<Workflow | null> {
    this.stopped = true; this.controller?.abort()
    if (this.planId) await this.engine.cancel(this.planId)
    return this.serial(async () => {
      const active = await this.active(); if (!active) return null
      const w = await this.flows.get(active.id, active.workspace)
      if (w.cancelled || !w.automatic || w.automatic.state === 'completed') return w
      return this.mark(w, 'paused', reason)
    })
  }
  tick(): Promise<Workflow | null> {
    return this.serial(async () => {
      const active = await this.active(); if (!active) return null
      let w = await this.flows.get(active.id, active.workspace)
      if (this.stopped || w.cancelled || w.automatic?.state !== 'running') return w
      const a = w.automatic, config = await this.engine.config()
      requireThat(Number.isSafeInteger(a.dispatches) && a.dispatches >= 0 && Number.isSafeInteger(a.limit) && a.limit >= 1 && a.limit <= 8 && a.dispatches <= a.limit && Number.isFinite(a.expiresAt), 'invalid_automatic_state')
      if (!config.execution) return this.mark(w, 'paused', 'execution_disabled')
      if (digest(config) !== a.configHash || w.approvedHash !== a.approvedHash || digest(w.analysis) !== a.approvedHash) return this.mark(w, 'paused', 'settings_changed')
      if (this.now() >= a.expiresAt) return this.mark(w, 'paused', 'expired')
      try {
        const entries = Object.entries(w.runs)
        if (entries.some(([, run]) => ['dispatch_unknown', 'dispatch_failed', 'dispatch_pending'].includes(run.state))) return this.mark(w, 'paused', 'dispatch_unknown')
        const submitted = entries.filter(([, run]) => run.state === 'submitted')
        requireThat(submitted.length <= 1, 'workflow_running')
        if (submitted.length) {
          const [stepId, run] = submitted[0]!
          // Existing manually launched work has no completion contract; allow one manual review.
          if (!run.result) return a.reason === 'legacy_review' ? w : this.mark(w, 'running', 'legacy_review')
          const elapsed = this.now() - (run.startedAt ?? 0)
          if (elapsed >= 30 * 60_000) return this.mark(w, 'paused', 'step_timeout')
          const observed = run.plan && this.runtime.observe ? await this.runtime.observe(run.plan, w.workspace) : 'unknown'
          if (this.stopped) return w
          if (observed === 'blocked' && elapsed > 15000) return this.mark(w, 'paused', 'agent_blocked')
          if (observed === 'unknown' && elapsed > 120000) return this.mark(w, 'paused', 'monitor_unavailable')
          if (observed !== 'done') return w
          // Read only after turn end: a partially written or provisional report is not a failure yet.
          let result
          try { result = await this.flows.result(w.id, stepId, w.workspace) }
          catch { return this.mark(w, 'paused', 'result_invalid') }
          if (result && (result.status !== 'completed' || result.questions.length || result.checks.some(c => c.status !== 'passed'))) return this.mark(w, 'paused', result.questions.length || result.status === 'blocked' ? 'agent_blocked' : 'checks_failed')
          if (!result) return elapsed <= 20000 ? w : this.mark(w, 'paused', 'result_missing')
          return this.flows.review(w.id, stepId, result.summary, w.workspace, true)
        }
        if (w.analysis!.steps.every(s => w.runs[s.id]?.state === 'completed')) return this.mark(w, 'completed', null)
        if (a.dispatches >= a.limit) return this.mark(w, 'paused', 'expired')
        const step = w.analysis!.steps.find(s => ['waiting', 'planned'].includes(w.runs[s.id]?.state ?? '') && s.dependsOn.every(id => w.runs[id]?.state === 'completed'))
        requireThat(step, 'workflow_not_ready')
        this.controller = new AbortController()
        w = await this.flows.route(w.id, step.id, w.workspace, true, this.controller.signal)
        const plan = w.runs[step.id]!.plan!
        this.planId = plan.id
        if (this.stopped || this.controller.signal.aborted) { await this.engine.cancel(plan.id); return w }
        if (!plan.evidence.verified) return this.mark(w, 'paused', 'unverified')
        if (plan.reason !== (config.live ? 'selected' : 'offline')) return this.mark(w, 'paused', 'routing_failed')
        // Recheck authorization after routing, before the irreversible launch request.
        if (this.now() >= a.expiresAt) return this.mark(w, 'paused', 'expired')
        const latest = await this.engine.config()
        if (digest(latest) !== a.configHash || !latest.execution) return this.mark(w, 'paused', 'settings_changed')
        w = await this.flows.automatic(w.id, w.workspace, { ...w.automatic!, reason: null, dispatches: a.dispatches + 1 })
        if (this.stopped) return w
        w = await this.flows.launch(w.id, step.id, w.workspace, true)
        if (w.runs[step.id]!.state !== 'submitted') return this.mark(w, 'paused', 'dispatch_unknown')
        return w
      } catch { return this.mark(await this.flows.get(w.id, w.workspace), 'paused', 'operation_failed') }
      finally { this.controller = null; this.planId = null }
    })
  }
}
