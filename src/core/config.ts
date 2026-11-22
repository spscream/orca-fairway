import { COORDINATOR_TASK_BYTES, COORDINATOR_PROMPT_BYTES } from './limits.ts'
import type { Config, Profile } from './types.ts'
export class RouterError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'RouterError' }
}
export function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RouterError(code)
}
export function record(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}
function exact(x: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(x).sort().join(',') === keys.sort().join(',')
}
export function validateProfile(x: unknown): Profile {
  requireThat(record(x) && exact(x, ['id', 'agent', 'model', 'effort', 'description', 'operatorConfirmed']), 'invalid_profile')
  requireThat(typeof x.id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(x.id), 'invalid_profile_id')
  requireThat(['codex', 'pi', 'cursor'].includes(x.agent as string), 'invalid_agent')
  requireThat(typeof x.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/.test(x.model) && !x.model.includes('..'), 'invalid_model')
  requireThat(x.effort === null || ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(x.effort as string), 'invalid_effort')
  requireThat(typeof x.description === 'string' && x.description.length >= 1 && x.description.length <= 400 && !x.description.includes('\0'), 'invalid_description')
  requireThat(typeof x.operatorConfirmed === 'boolean', 'invalid_verification')
  if (x.agent === 'pi') requireThat(x.model.includes('/') && x.effort !== null && x.effort !== 'none', 'invalid_pi_pair')
  if (x.agent === 'codex') requireThat(!x.model.includes('/') && x.effort !== null && x.effort !== 'off', 'invalid_codex_pair')
  // Cursor effort is already encoded in the exact native model alias; never invent a separate flag.
  if (x.agent === 'cursor') requireThat(x.effort === null && x.model !== 'auto', 'invalid_cursor_pair')
  return structuredClone(x) as unknown as Profile
}
export function validateConfig(x: unknown): Config {
  // Existing installations retain finite limits until the operator opts in.
  if (record(x) && !Object.hasOwn(x, 'unlimitedJev')) x = { ...x, unlimitedJev: false }
  requireThat(record(x) && exact(x, ['version', 'profiles', 'fallback', 'live', 'execution', 'budgetMicrousd', 'maxCalls', 'unlimitedJev']), 'invalid_config')
  requireThat(x.version === 1 && Array.isArray(x.profiles) && x.profiles.length >= 1 && x.profiles.length <= 24, 'invalid_profiles')
  const profiles = x.profiles.map(validateProfile)
  requireThat(new Set(profiles.map(p => p.id)).size === profiles.length, 'duplicate_profile')
  requireThat(typeof x.fallback === 'string' && profiles.some(p => p.id === x.fallback), 'invalid_fallback')
  requireThat(typeof x.live === 'boolean' && typeof x.execution === 'boolean' && typeof x.unlimitedJev === 'boolean', 'invalid_modes')
  requireThat(Number.isSafeInteger(x.budgetMicrousd) && (x.budgetMicrousd as number) >= 0, 'invalid_budget')
  requireThat(Number.isSafeInteger(x.maxCalls) && (x.maxCalls as number) >= 0, 'invalid_call_limit')
  return { ...x, profiles } as unknown as Config
}
export function validateTask(x: unknown): asserts x is string {
  requireThat(typeof x === 'string' && x.trim().length > 0 && Buffer.byteLength(x) <= 4096 && !x.includes('\0'), 'invalid_task')
}
export function validateCoordinatorTask(x: unknown): asserts x is string {
  requireThat(typeof x === 'string' && x.trim().length > 0 && !x.includes('\0'), 'invalid_task')
  requireThat(Buffer.byteLength(x) <= COORDINATOR_TASK_BYTES, 'workflow_task_too_large')
}
export function validateCoordinatorPrompt(x: unknown): asserts x is string {
  requireThat(typeof x === 'string' && x.trim().length > 0 && !x.includes('\0'), 'invalid_task')
  requireThat(Buffer.byteLength(x) <= COORDINATOR_PROMPT_BYTES, 'coordinator_prompt_too_large')
}
// Examples only: launch remains blocked until metadata verifies the exact pair.
export const DEFAULT_CONFIG: Config = {
  version: 1, live: false, unlimitedJev: false, execution: false, budgetMicrousd: 100_000, maxCalls: 5,
  fallback: 'standard', profiles: [
    { id: 'routine', agent: 'codex', model: 'gpt-6-luna', effort: 'low', description: 'Small, local, well-specified task with direct checks.', operatorConfirmed: false },
    { id: 'standard', agent: 'codex', model: 'gpt-6.1-sol', effort: 'medium', description: 'Ordinary investigation or implementation, several steps and moderate ambiguity.', operatorConfirmed: false },
    { id: 'deep', agent: 'codex', model: 'gpt-6-astra', effort: 'high', description: 'Difficult architecture, distributed failures, protocol invariants and explicit tradeoffs.', operatorConfirmed: false }
  ]
}
