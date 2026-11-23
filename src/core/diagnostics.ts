import { record } from './config.ts'
import { savedId } from './saved-plan.ts'

export const DIAGNOSTIC_HISTORY_LIMIT = 200

const states = new Set([
  'planning', 'shadow', 'cancelled', 'dispatch_pending', 'submitted', 'dispatch_unknown',
  'dispatch_failed', 'waiting', 'planned', 'completed', 'analysis_prepared', 'coordinator_refreshed',
  'analysis_loaded', 'analysis_approved', 'step_planned', 'step_dispatch_pending', 'step_reviewed',
  'workflow_cancelled', 'workflow_repaired', 'automatic_running', 'automatic_paused', 'automatic_completed',
])
const reasons = new Set([
  'offline', 'coordinator_profile', 'selected', 'cancelled', 'timeout', 'budget_exhausted',
  'missing_key', 'routing_timeout', 'low_confidence', 'low_confidence_ranked', 'low_confidence_fallback',
  'invalid_choice', 'invalid_response', 'invalid_cost', 'pricing_unbounded', 'http_error',
  'decision_unavailable', 'request_too_large', 'paused', 'interrupted', 'settings_changed', 'expired',
  'execution_disabled', 'routing_failed', 'unverified', 'dispatch_unknown', 'agent_blocked',
  'monitor_unavailable', 'result_missing', 'result_invalid', 'checks_failed', 'legacy_review',
  'step_timeout', 'repair_limit', 'analysis_needs_input', 'operation_failed', 'prompt_too_large', 'review_required', 'ledger_locked',
  'invalid_probabilities', 'plan_changed', 'invalid_ledger', 'ledger_path_refused', 'endpoint_refused',
  'invalid_response_limit', 'invalid_key', 'request_timeout', 'request_cancelled', 'http_unavailable', 'response_too_large',
])
const stages = new Set(['prepare', 'observe', 'report', 'dispatch'])

export type DiagnosticEvent = {
  at: number
  state: string
  id?: string
  flowId?: string
  reason?: string
  stage?: string
}

export function diagnosticEvent(value: unknown): DiagnosticEvent | null {
  if (!record(value) || typeof value.state !== 'string' || !states.has(value.state) ||
      typeof value.at !== 'number' || !Number.isInteger(value.at) || value.at < 0 || value.at > 8.64e15) return null
  // Only request and workflow UUIDs are allowed. Profile and step names can contain arbitrary text.
  return {
    at: value.at,
    state: value.state,
    ...(savedId(value.id) ? { id: value.id } : {}),
    ...(savedId(value.flowId) ? { flowId: value.flowId } : {}),
    ...(typeof value.reason === 'string' && reasons.has(value.reason) ? { reason: value.reason } : {}),
    ...(typeof value.stage === 'string' && stages.has(value.stage) ? { stage: value.stage } : {}),
  }
}

export function diagnosticHistory(value: unknown): DiagnosticEvent[] {
  if (!Array.isArray(value)) return []
  const events: DiagnosticEvent[] = []
  for (let i = value.length - 1; i >= 0 && events.length < DIAGNOSTIC_HISTORY_LIMIT; i--) {
    const event = diagnosticEvent(value[i])
    if (event) events.push(event)
  }
  return events.reverse()
}

export function diagnosticExport(history: unknown): string {
  return JSON.stringify({ version: 1, events: diagnosticHistory(history) }, null, 2) + '\n'
}
