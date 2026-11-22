import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, validateConfig, validateProfile } from '../src/core/config.ts'
import { atLeastFallback, PROFILE_LEVELS } from '../src/core/profile-level.ts'
import { validateAnswer } from '../src/core/jev.ts'

test('profile levels are explicit, ordered across agents and unknown levels never imply strength', () => {
  const base = DEFAULT_CONFIG.profiles[1]!
  for (const [i, level] of PROFILE_LEVELS.entries()) for (const [j, floor] of PROFILE_LEVELS.entries()) {
    assert.equal(atLeastFallback({ ...base, level, agent: 'cursor', model: 'synthetic', effort: null }, { ...base, level: floor }), i >= j)
  }
  for (const level of [null, undefined]) {
    assert.equal(atLeastFallback({ ...base, id: 'deep', level }, { ...base, level: 'routine' }), false)
    assert.equal(atLeastFallback({ ...base, level: 'deep' }, { ...base, level }), false)
  }
  assert.equal(atLeastFallback({ ...base, level: 'deep' }, undefined), false)
})
test('legacy profiles migrate to unranked without inferring from names; strict invalid levels are rejected', () => {
  const old = structuredClone(DEFAULT_CONFIG); old.profiles.forEach(p => { delete p.level })
  const migrated = validateConfig(old)
  assert.ok(migrated.profiles.every(p => p.level === null))
  assert.deepEqual(validateConfig(migrated), migrated)
  for (const level of ['strong', 'DEEP', 2, false, {}, '__proto__']) assert.throws(() => validateProfile({ ...DEFAULT_CONFIG.profiles[0], level }), /invalid_profile_level/)
  assert.throws(() => validateProfile({ ...DEFAULT_CONFIG.profiles[0], rank: 'deep' }), /invalid_profile/)
})
test('a higher profile level cannot make an invalid non-leading or injected JEV answer valid', () => {
  const answer = (choice: string) => ({ answers: { profile: { type: 'choice', choice, confidence: .2, probabilities: { routine: .8, standard: .1, deep: .1 } } }, usage: { cost: 0 } })
  assert.throws(() => validateAnswer(answer('deep'), DEFAULT_CONFIG.profiles), /invalid_probabilities/)
  assert.throws(() => validateAnswer(answer('deep;synthetic'), DEFAULT_CONFIG.profiles), /invalid_choice/)
  assert.equal(validateAnswer(answer('routine'), DEFAULT_CONFIG.profiles).profile.id, 'routine')
})
