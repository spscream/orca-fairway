import type { Profile } from './types.ts'
export const PROFILE_LEVELS = ['routine', 'standard', 'deep'] as const
/** Operator-assigned levels only; never infer ability from an ID, agent or model. */
export function atLeastFallback(profile: Profile, fallback: Profile | undefined): boolean {
  const rank = (p: Profile | undefined) => PROFILE_LEVELS.indexOf(p?.level as typeof PROFILE_LEVELS[number])
  return rank(profile) >= 0 && rank(fallback) >= 0 && rank(profile) >= rank(fallback)
}
