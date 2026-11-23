import { ROUTING_BRIEF_BYTES } from './limits.ts'
import { launchReceipt } from './launch-receipt.ts'
import { atLeastFallback } from './profile-level.ts'
import { parseJson } from './json.ts'
import { createHash, randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG, record, requireThat, RouterError, validateConfig, validateProfile, validateTask, validateCoordinatorPrompt, validateWorkflowPrompt } from './config.ts'
import { httpTransport, makeRequest, METADATA_URL, DECISIONS_URL, RESERVATION_MICROUSD, validatePrice, validateAnswer } from './jev.ts'
import type { Agent, Config, Ledger, Plan, Runtime, Store, Transport, Workspace } from './types.ts'
import { savedPlan, savedId as validPlanId } from './saved-plan.ts'
import { DIAGNOSTIC_HISTORY_LIMIT, diagnosticEvent, diagnosticHistory, type DiagnosticEvent } from './diagnostics.ts'
export const digest = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')

async function interruptible<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let listener: () => void = () => {}
  try {
    return await Promise.race([action(), new Promise<T>((_, reject) => {
      listener = () => reject(new RouterError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'))
      signal.addEventListener('abort', listener, { once: true })
    })])
  } finally { signal.removeEventListener('abort', listener) }
}
const storeQueues = new WeakMap<Store, Promise<unknown>>()
export class Engine {
  private keyGeneration = 0
  private active = new Map<string, AbortController>()
  constructor(private readonly store: Store, private readonly runtime: Runtime,
    private readonly getKey: () => Promise<string | null>, private readonly transport: Transport = httpTransport,
    private readonly timeoutMs = 8000) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = () => this.store.exclusive ? this.store.exclusive(action) : action()
    const tail = storeQueues.get(this.store) ?? Promise.resolve()
    const next = tail.then(run, run)
    storeQueues.set(this.store, next.catch(() => {}))
    return next
  }
  async config(): Promise<Config> { return validateConfig((await this.store.get('config')) ?? DEFAULT_CONFIG) }
  async saveConfig(value: unknown): Promise<Config> {
    const c = validateConfig(value)
    for (const controller of this.active.values()) controller.abort()
    await this.serial(() => this.store.set('config', c)); return c
  }
  private async keyRevision(): Promise<string | null> {
    const revision = await this.store.get('keyRevision')
    requireThat(revision === null || validPlanId(revision), 'invalid_key_revision')
    return revision as string | null
  }
  async changeKey(write: () => Promise<void>): Promise<void> {
    this.keyGeneration++
    this.cancelAll()
    await this.serial(async () => {
      await this.store.set('keyRevision', randomUUID())
      await write()
    })
  }
  async isCurrent(plan: Plan, config: Config): Promise<boolean> {
    return plan.configHash === digest(config) && (plan.keyRevision ?? null) === await this.keyRevision()
  }
  async ledger(): Promise<Ledger> {
    const l = (await this.store.get('ledger')) ?? { calls: 0, reservedMicrousd: 0 }
    requireThat(record(l) && Object.keys(l).sort().join(',') === 'calls,reservedMicrousd' && Number.isSafeInteger(l.calls) && Number(l.calls) >= 0 && Number.isSafeInteger(l.reservedMicrousd) && Number(l.reservedMicrousd) >= 0, 'invalid_ledger')
    return l as unknown as Ledger
  }
  private async reserve(config: Config): Promise<void> {
    await this.serial(async () => {
      requireThat(digest(config) === digest(await this.config()), 'plan_changed')
      const l = await this.ledger()
      requireThat(config.unlimitedJev || (l.calls < config.maxCalls && l.reservedMicrousd + RESERVATION_MICROUSD <= config.budgetMicrousd), 'budget_exhausted')
      requireThat(Number.isSafeInteger(l.calls + 1) && Number.isSafeInteger(l.reservedMicrousd + RESERVATION_MICROUSD), 'invalid_ledger')
      await this.store.set('ledger', { calls: l.calls + 1, reservedMicrousd: l.reservedMicrousd + RESERVATION_MICROUSD })
    })
  }
  private async audit(event: Record<string, unknown>): Promise<void> {
    const safe = diagnosticEvent({ ...event, at: Date.now() })
    if (!safe) return
    await this.serial(async () => {
      // Rewrite the sanitized history on append to repair legacy or malformed storage.
      const previous = await this.history()
      await this.store.set('audit', [...previous.slice(1 - DIAGNOSTIC_HISTORY_LIMIT), safe])
    })
  }
  async history(): Promise<DiagnosticEvent[]> {
    return diagnosticHistory(await this.store.get('audit'))
  }
  cancelAll(): void { for (const c of this.active.values()) c.abort() }
  async cancel(id: string): Promise<void> {
    requireThat(validPlanId(id), 'invalid_plan')
    this.active.get(id)?.abort()
    await this.serial(async () => {
      const p = await this.store.get('plan:' + id)
      if (record(p) && p.state === 'shadow') await this.store.set('plan:' + id, { ...p, state: 'cancelled' })
    })
  }
  async plan(task: string, agent: Agent | 'auto', workspace: Workspace, requestId: string = randomUUID(), externalSignal?: AbortSignal,
    options: { routingTask?: string; allowedAgents?: Agent[]; profileId?: string; coordinator?: boolean; workflow?: boolean } = {}): Promise<Plan> {
    requireThat(!options.workflow || (!options.coordinator && options.profileId === undefined && options.routingTask !== undefined && options.allowedAgents !== undefined && agent === 'auto'), 'invalid_workflow_plan')
    if (options.workflow) requireThat(Array.isArray(options.allowedAgents) && options.allowedAgents.length >= 1 && options.allowedAgents.length <= 3 && new Set(options.allowedAgents).size === options.allowedAgents.length && options.allowedAgents.every(a => ['codex', 'pi', 'cursor'].includes(a)), 'invalid_workflow_plan')
    requireThat(!options.coordinator || (agent === 'auto' && options.allowedAgents === undefined && ((options.profileId !== undefined) !== (options.routingTask !== undefined))), 'invalid_coordinator_plan')
    if (options.coordinator) validateCoordinatorPrompt(task); else if (options.workflow) validateWorkflowPrompt(task); else validateTask(task)
    if (options.routingTask !== undefined) validateTask(options.routingTask, ROUTING_BRIEF_BYTES)
    requireThat(validPlanId(requestId), 'invalid_request_id')
    requireThat(workspace.host === 'local' && typeof workspace.path === 'string' && workspace.path.length > 0 && typeof workspace.id === 'string', 'invalid_workspace')
    const keyGeneration = this.keyGeneration, keyRevision = await this.keyRevision()
    const c = await this.config()
    if (options.profileId !== undefined) requireThat(typeof options.profileId === 'string' && c.profiles.some(p => p.id === options.profileId), 'invalid_profile')
    const candidates = c.profiles.filter(p => (agent === 'auto' || p.agent === agent) && (!options.allowedAgents || options.allowedAgents.includes(p.agent)) && (!options.profileId || p.id === options.profileId))
    requireThat(candidates.length, 'no_profiles_for_agent')
    await this.serial(async () => {
      requireThat((await this.store.get('plan:' + requestId)) == null, 'duplicate_request')
      await this.store.set('plan:' + requestId, { id: requestId, state: 'planning' })
    })
    let profile = candidates.find(p => p.id === c.fallback) ?? candidates[0]!
    const controller = new AbortController(); this.active.set(requestId, controller)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs), ...(externalSignal ? [externalSignal] : [])])
    let reason = 'offline', confidence: number | null = null, costUsd: number | null = null, reservedMicrousd = 0
    try {
      await this.audit({ id: requestId, state: 'planning' })
      try {
        if (options.profileId !== undefined) reason = 'coordinator_profile'
        else if (c.live) {
          const key = await this.getKey()
          if (!key) reason = 'missing_key'
          else {
            signal.throwIfAborted()
            const body = makeRequest(options.routingTask ?? task, candidates)
            await this.reserve(c); reservedMicrousd = RESERVATION_MICROUSD
            await interruptible(async () => {
              validatePrice(await this.transport(METADATA_URL, { signal }))
              signal.throwIfAborted()
              const answer = validateAnswer(await this.transport(DECISIONS_URL, { signal, body, key }), candidates)
              signal.throwIfAborted()
              costUsd = answer.cost; confidence = answer.confidence
              if (confidence >= .6) { profile = answer.profile; reason = 'selected' }
              else if (atLeastFallback(answer.profile, candidates.find(p => p.id === c.fallback))) { profile = answer.profile; reason = 'low_confidence_ranked' }
              else reason = 'low_confidence_fallback'
            }, signal)
          }
        }
      } catch (error) {
        reason = signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled') : error instanceof RouterError ? error.code : 'decision_unavailable'
      }
      // A changed configuration or an aborted request can never produce an executable late result.
      const evidence = await this.runtime.verify(profile).catch(() => ({ verified: false, source: 'verification_unavailable' }))
      const changed = digest(await this.config()) !== digest(c) || keyRevision !== await this.keyRevision() || keyGeneration !== this.keyGeneration
      const cancelled = controller.signal.aborted || externalSignal?.aborted || changed
      const plan: Plan = {
        ...(options.coordinator ? { purpose: 'coordinator' as const } : {}),
        ...(options.workflow ? { purpose: 'workflow' as const } : {}),
        id: requestId, keyRevision, profile, reason: cancelled ? 'cancelled' : reason, confidence,
        createdAt: Date.now(), expiresAt: Date.now() + 10 * 60_000, configHash: digest(c), taskHash: digest(task), workspaceHash: digest(workspace),
        evidence, costUsd, reservedMicrousd, state: cancelled ? 'cancelled' : 'shadow', observedModel: null, observedEffort: null
      }
      await this.serial(async () => {
        if (controller.signal.aborted || externalSignal?.aborted) { plan.state = 'cancelled'; plan.reason = 'cancelled' }
        await this.store.set('plan:' + requestId, plan)
      })
      await this.audit({ id: requestId, state: plan.state, reason: plan.reason })
      return plan
    } finally { this.active.delete(requestId) }
  }
  async workflowEvent(flowId: string, state: string, stepId?: string, diagnostic?: { reason: string | null; stage?: string }): Promise<void> {
    await this.audit({ flowId, state, ...(stepId ? { stepId } : {}), ...diagnostic })
  }
  async launch(id: string, task: string, workspace: Workspace, beforeDispatch?: () => void, expected?: Plan): Promise<Plan> {
    requireThat(validPlanId(id), 'invalid_plan')
    const keyGeneration = this.keyGeneration
    const p = await this.store.get('plan:' + id)
    requireThat(p != null, 'plan_not_found')
    const plan = savedPlan(p, id), config = await this.config()
    if (expected) requireThat(digest(plan) === digest(expected), 'plan_changed')
    if (plan.purpose === 'coordinator') validateCoordinatorPrompt(task); else if (plan.purpose === 'workflow') validateWorkflowPrompt(task); else validateTask(task)
    requireThat(config.execution, 'execution_disabled')
    validateProfile(plan.profile)
    requireThat(config.profiles.some(profile => digest(profile) === digest(plan.profile)), 'profile_changed')
    requireThat(plan.state === 'shadow' && plan.expiresAt > Date.now(), 'plan_not_launchable')
    requireThat(await this.isCurrent(plan, config) && plan.taskHash === digest(task) && plan.workspaceHash === digest(workspace), 'plan_changed')
    requireThat(plan.reason !== 'cancelled' && plan.evidence.verified && (await this.runtime.verify(plan.profile)).verified, 'profile_unverified')
    await this.serial(async () => {
      const latest = await this.config()
      requireThat(latest.execution && await this.isCurrent(plan, latest), 'plan_changed')
      const current = await this.store.get('plan:' + id)
      requireThat(record(current) && current.state === 'shadow', 'plan_already_consumed')
      requireThat(digest(savedPlan(current, id)) === digest(plan), 'plan_changed')
      plan.state = 'dispatch_pending'
      await this.store.set('plan:' + id, plan)
    })
    // Persisted intent + audit before starting a process; an unknown outcome is never retried.
    await this.audit({ id, state: 'dispatch_pending' })
    const latest = await this.config()
    const current = await this.isCurrent(plan, latest)
    try {
      requireThat(latest.execution && current && keyGeneration === this.keyGeneration, 'plan_changed')
      beforeDispatch?.()
    } catch (error) {
      // Dispatch has not reached the runtime. Restore the intent for an explicit retry.
      plan.state = 'shadow'
      await this.serial(() => this.store.set('plan:' + id, plan))
      throw error
    }
    // No await between the cancellation check and handing the request to Orca.
    try {
      const result = await this.runtime.launch(plan.profile, task, workspace)
      let receipt: unknown
      try { receipt = parseJson(result.stdout) } catch { receipt = null }
      const confirmed = result.code === 0 ? launchReceipt(receipt) : null
      if (confirmed) plan.dispatch = confirmed
      plan.state = confirmed ? 'submitted' : result.code !== 0 ? 'dispatch_failed' : 'dispatch_unknown'
    } catch { plan.state = 'dispatch_unknown' }
    await this.serial(() => this.store.set('plan:' + id, plan))
    await this.audit({ id, state: plan.state })
    return plan
  }
}
