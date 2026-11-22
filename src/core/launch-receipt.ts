import { record } from './config.ts'
import type { Plan } from './types.ts'
/** agent launch returns the launch directly; worktree create wraps it in result.launch. */
export function launchReceipt(value: unknown): NonNullable<Plan['dispatch']> | null {
  if (!record(value) || value.ok !== true || !record(value.result)) return null
  const launch = record(value.result.launch) ? value.result.launch : value.result
  if (!record(launch.outcome) || !record(launch.prompt)) return null
  const { kind, handle } = launch.outcome
  if (!['structured', 'terminal'].includes(String(kind)) || typeof handle !== 'string' || !/^[a-zA-Z0-9_:./-]{1,256}$/.test(handle)) return null
  if (!['journaled', 'handed-to-terminal'].includes(String(launch.prompt.outcome))) return null
  // Retain identifiers only; never store prompt text, warnings or the full CLI response.
  const operationId = value.result.operationId ?? launch.operationId
  return { kind: kind as 'structured' | 'terminal', handle,
    ...(typeof operationId === 'string' && /^[a-zA-Z0-9_:.-]{1,160}$/.test(operationId) ? { operationId } : {}) }
}
