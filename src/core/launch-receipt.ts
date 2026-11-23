import { record } from './config.ts'
import type { Plan } from './types.ts'
const handlePattern = /^[a-zA-Z0-9_:./-]{1,256}$/
const sessionPattern = /^[a-zA-Z0-9_-]{1,128}$/
const operationPattern = /^[a-zA-Z0-9_:.-]{1,160}$/
export function validDispatch(value: unknown): boolean {
  return record(value) && Object.keys(value).every(k => ['kind', 'handle', 'sessionId', 'operationId'].includes(k)) &&
    (value.kind === 'terminal' || value.kind === 'structured') && typeof value.handle === 'string' && handlePattern.test(value.handle) &&
    (value.sessionId === undefined || typeof value.sessionId === 'string' && sessionPattern.test(value.sessionId)) &&
    (value.operationId === undefined || typeof value.operationId === 'string' && operationPattern.test(value.operationId))
}
/** agent launch returns the launch directly; worktree create wraps it in result.launch. */
export function launchReceipt(value: unknown): NonNullable<Plan['dispatch']> | null {
  if (!record(value) || value.ok !== true || !record(value.result)) return null
  const launch = record(value.result.launch) ? value.result.launch : value.result
  if (!record(launch.outcome) || !record(launch.prompt)) return null
  const { kind, handle } = launch.outcome
  if (!['structured', 'terminal'].includes(kind as string) || typeof handle !== 'string' || !handlePattern.test(handle)) return null
  if (!['journaled', 'handed-to-terminal'].includes(launch.prompt.outcome as string)) return null
  // Retain identifiers only; never store prompt text, warnings or the full CLI response.
  const operationId = value.result.operationId ?? launch.operationId
  return { kind: kind as 'structured' | 'terminal', handle,
    ...(typeof launch.outcome.sessionId === 'string' && sessionPattern.test(launch.outcome.sessionId) ? { sessionId: launch.outcome.sessionId } : {}),
    ...(typeof operationId === 'string' && operationPattern.test(operationId) ? { operationId } : {}) }
}
