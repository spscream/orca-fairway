import { record, requireThat, validateProfile } from './config.ts'
import { validDispatch } from './launch-receipt.ts'
import type { Plan } from './types.ts'

export const savedId = (v: unknown): v is string => typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
export const savedHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
export const unsigned = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const label = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 256 && !v.includes('\0')

export function savedPlan(v: unknown, id?: string): Plan {
  requireThat(record(v) && savedId(v.id) && (id === undefined || v.id === id), 'invalid_plan')
  validateProfile(v.profile)
  requireThat(record(v.evidence) && typeof v.evidence.verified === 'boolean' && label(v.evidence.source) &&
    label(v.reason) && (v.confidence === null || typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1) &&
    (v.costUsd === null || typeof v.costUsd === 'number' && Number.isFinite(v.costUsd) && v.costUsd >= 0) &&
    unsigned(v.reservedMicrousd) && unsigned(v.createdAt) && unsigned(v.expiresAt) &&
    savedHash(v.configHash) && savedHash(v.taskHash) && savedHash(v.workspaceHash) &&
    (v.observedModel === null || label(v.observedModel)) && (v.observedEffort === null || label(v.observedEffort)) &&
    (v.keyRevision == null || savedId(v.keyRevision)) &&
    (v.purpose === undefined || v.purpose === 'coordinator' || v.purpose === 'workflow') &&
    ['shadow', 'cancelled', 'dispatch_pending', 'submitted', 'dispatch_unknown', 'dispatch_failed'].includes(v.state as string) &&
    (v.dispatch === undefined || v.state === 'submitted' && validDispatch(v.dispatch)), 'invalid_plan')
  return v as unknown as Plan
}
