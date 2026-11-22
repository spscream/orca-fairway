import { RESERVATION_MICROUSD } from './limits.ts'
import type { Config, Ledger } from './types.ts'
import type { Workflow, AutomaticReason } from './workflow.ts'
export function routingBudget(config: Config, ledger: Ledger, workflow: Workflow) {
  const needed = config.live ? (workflow.analysis?.steps.filter(step => !['submitted', 'completed'].includes(workflow.runs[step.id]?.state ?? 'waiting')).length ?? 0) : 0
  if (config.unlimitedJev) return { needed, affordable: null, sufficient: true }
  const callsLeft = Math.max(0, config.maxCalls - ledger.calls)
  const reserveLeft = Math.max(0, config.budgetMicrousd - ledger.reservedMicrousd)
  const affordable = Math.min(callsLeft, Math.floor(reserveLeft / RESERVATION_MICROUSD))
  return { needed, affordable, sufficient: !config.live || affordable >= needed }
}
export function routingFailure(reason: string): AutomaticReason {
  if (reason === 'budget_exhausted' || reason === 'missing_key' || reason === 'pricing_unbounded' || reason === 'http_error') return reason
  if (reason === 'timeout') return 'routing_timeout'
  if (reason === 'low_confidence_fallback') return 'low_confidence'
  if (['invalid_choice', 'invalid_response', 'invalid_probabilities', 'invalid_cost', 'duplicate_json_key', 'invalid_json'].includes(reason)) return 'invalid_choice'
  return 'routing_failed'
}
export function storedRoutingFailure(w: Workflow): AutomaticReason {
  const run = w.analysis?.steps.map(step => w.runs[step.id]).find(run => run?.state === 'planned' && run.plan && !['selected', 'offline'].includes(run.plan.reason))
  return routingFailure(run?.plan?.reason ?? '')
}
