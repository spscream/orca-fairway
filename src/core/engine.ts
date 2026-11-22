import { launchReceipt } from './launch-receipt.ts'
import { atLeastFallback } from './profile-level.ts'
import { parseJson } from './json.ts'
import { createHash, randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG, record, requireThat, RouterError, validateConfig, validateProfile, validateTask, validateCoordinatorPrompt } from './config.ts'
import { httpTransport, makeRequest, METADATA_URL, DECISIONS_URL, RESERVATION_MICROUSD, validatePrice, validateAnswer } from './jev.ts'
import type { Agent, Config, Ledger, Plan, Runtime, Store, Transport, Workspace } from './types.ts'
export const digest = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const validPlanId = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)
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
export class Engine {
  private tail: Promise<unknown> = Promise.resolve()
  private active = new Map<string, AbortController>()
  constructor(private readonly store: Store, private readonly runtime: Runtime,
    private readonly getKey: () => Promise<string | null>, private readonly transport: Transport = httpTransport,
    private readonly timeoutMs = 8000) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action); this.tail = next.catch(() => {}); return next
  }
  async config(): Promise<Config> { return validateConfig((await this.store.get('config')) ?? DEFAULT_CONFIG) }
  async saveConfig(value: unknown): Promise<Config> {
    const c = validateConfig(value)
    for (const controller of this.active.values()) controller.abort()
    await this.serial(() => this.store.set('config', c)); return c
  }
  async ledger(): Promise<Ledger> {
    const l = (await this.store.get('ledger')) ?? { calls: 0, reservedMicrousd: 0 }
    requireThat(record(l) && Object.keys(l).sort().join(',') === 'calls,reservedMicrousd' && Number.isSafeInteger(l.calls) && Number(l.calls) >= 0 && Number.isSafeInteger(l.reservedMicrousd) && Number(l.reservedMicrousd) >= 0, 'invalid_ledger')
    return l as unknown as Ledger
  }
  private async reserve(config: Config): Promise<void> {
    await this.serial(async () => {
      const l = await this.ledger()
      requireThat(config.unlimitedJev || (l.calls < config.maxCalls && l.reservedMicrousd + RESERVATION_MICROUSD <= config.budgetMicrousd), 'budget_exhausted')
      requireThat(Number.isSafeInteger(l.calls + 1) && Number.isSafeInteger(l.reservedMicrousd + RESERVATION_MICROUSD), 'invalid_ledger')
      await this.store.set('ledger', { calls: l.calls + 1, reservedMicrousd: l.reservedMicrousd + RESERVATION_MICROUSD })
    })
  }
  private async audit(event: Record<string, unknown>): Promise<void> {
    await this.serial(async () => {
      const previous = (await this.store.get('audit')) ?? []
      requireThat(Array.isArray(previous), 'invalid_audit')
      await this.store.set('audit', [...previous.slice(-199), { at: Date.now(), ...event }])
    })
  }
  async history(): Promise<unknown[]> {
    const a = (await this.store.get('audit')) ?? []; requireThat(Array.isArray(a), 'invalid_audit'); return a
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
    options: { routingTask?: string; allowedAgents?: Agent[]; profileId?: string; coordinator?: boolean } = {}): Promise<Plan> {
    requireThat(!options.coordinator || (options.profileId !== undefined && options.routingTask === undefined && options.allowedAgents === undefined), 'invalid_coordinator_plan')
    if (options.coordinator) validateCoordinatorPrompt(task); else validateTask(task)
    if (options.routingTask !== undefined) validateTask(options.routingTask)
    requireThat(validPlanId(requestId), 'invalid_request_id')
    requireThat(workspace.host === 'local' && typeof workspace.path === 'string' && workspace.path.length > 0 && typeof workspace.id === 'string', 'invalid_workspace')
    const c = await this.config()
    if (options.profileId !== undefined) requireThat(typeof options.profileId === 'string' && c.profiles.some(p => p.id === options.profileId), 'invalid_profile')
    const candidates = c.profiles.filter(p => (agent === 'auto' || p.agent === agent) && (!options.allowedAgents || options.allowedAgents.includes(p.agent)) && (!options.profileId || p.id === options.profileId))
    requireThat(candidates.length, 'no_profiles_for_agent')
    await this.serial(async () => {
      requireThat(!(await this.store.get('plan:' + requestId)), 'duplicate_request')
      await this.store.set('plan:' + requestId, { id: requestId, state: 'planning' })
    })
    let profile = candidates.find(p => p.id === c.fallback) ?? candidates[0]!
    const controller = new AbortController(); this.active.set(requestId, controller)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs), ...(externalSignal ? [externalSignal] : [])])
    let reason = 'offline', confidence: number | null = null, costUsd: number | null = null, reservedMicrousd = 0
    try {
      await this.audit({ id: requestId, state: 'planning', agent })
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
      const changed = digest(await this.config()) !== digest(c)
      const cancelled = controller.signal.aborted || externalSignal?.aborted || changed
      const plan: Plan = {
        ...(options.coordinator ? { purpose: 'coordinator' as const } : {}),
        id: requestId, profile, reason: cancelled ? 'cancelled' : reason, confidence,
        createdAt: Date.now(), expiresAt: Date.now() + 10 * 60_000, configHash: digest(c), taskHash: digest(task), workspaceHash: digest(workspace),
        evidence, costUsd, reservedMicrousd, state: cancelled ? 'cancelled' : 'shadow', observedModel: null, observedEffort: null
      }
      await this.serial(async () => {
        if (controller.signal.aborted || externalSignal?.aborted) { plan.state = 'cancelled'; plan.reason = 'cancelled' }
        await this.store.set('plan:' + requestId, plan)
      })
      await this.audit({ id: requestId, state: plan.state, profile: profile.id, agent: profile.agent, model: profile.model, effort: profile.effort, reason: plan.reason, confidence, costUsd, reservedMicrousd })
      return plan
    } finally { this.active.delete(requestId) }
  }
  async workflowEvent(flowId: string, state: string, stepId?: string): Promise<void> {
    await this.audit({ flowId, state, ...(stepId ? { stepId } : {}) })
  }
  async launch(id: string, task: string, workspace: Workspace): Promise<Plan> {
    requireThat(validPlanId(id), 'invalid_plan')
    const p = await this.store.get('plan:' + id)
    requireThat(record(p) && p.id === id, 'invalid_plan')
    const plan = p as unknown as Plan, config = await this.config()
    if (plan.purpose === 'coordinator' && plan.reason === 'coordinator_profile') validateCoordinatorPrompt(task); else validateTask(task)
    requireThat(config.execution, 'execution_disabled')
    validateProfile(plan.profile)
    requireThat(config.profiles.some(profile => digest(profile) === digest(plan.profile)), 'profile_changed')
    requireThat(plan.state === 'shadow' && plan.expiresAt > Date.now(), 'plan_not_launchable')
    requireThat(plan.configHash === digest(config) && plan.taskHash === digest(task) && plan.workspaceHash === digest(workspace), 'plan_changed')
    requireThat(plan.reason !== 'cancelled' && (await this.runtime.verify(plan.profile)).verified, 'profile_unverified')
    await this.serial(async () => {
      const latest = await this.config()
      requireThat(latest.execution && digest(latest) === plan.configHash, 'plan_changed')
      const current = await this.store.get('plan:' + id)
      requireThat(record(current) && current.state === 'shadow', 'plan_already_consumed')
      plan.state = 'dispatch_pending'
      await this.store.set('plan:' + id, plan)
    })
    // Persisted intent + audit before starting a process; an unknown outcome is never retried.
    await this.audit({ id, state: 'dispatch_pending', profile: plan.profile.id })
    try {
      const result = await this.runtime.launch(plan.profile, task, workspace)
      let receipt: unknown
      try { receipt = parseJson(result.stdout) } catch { receipt = null }
      const confirmed = result.code === 0 ? launchReceipt(receipt) : null
      if (confirmed) plan.dispatch = confirmed
      plan.state = confirmed ? 'submitted' : result.code !== 0 ? 'dispatch_failed' : 'dispatch_unknown'
    } catch { plan.state = 'dispatch_unknown' }
    await this.serial(() => this.store.set('plan:' + id, plan))
    await this.audit({ id, state: plan.state, profile: plan.profile.id })
    return plan
  }
}
