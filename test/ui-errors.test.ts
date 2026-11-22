import { test } from 'node:test'
import assert from 'node:assert/strict'
import { knownErrorCode } from '../src/core/ui-errors.ts'
test('wrapped and structured worker errors map to known codes without exposing raw strings', () => {
  const known = new Set(['analysis_not_found', 'invalid_model'])
  for (const value of [new Error('analysis_not_found'), { code: 'analysis_not_found', message: 'hidden' }, { data: { requestCode: 'analysis_not_found' } }, { details: { requestCode: 'analysis_not_found' } }, new Error('Plugin request failed: analysis_not_found (synthetic private text)')]) assert.equal(knownErrorCode(value, known), 'analysis_not_found')
  assert.equal(knownErrorCode(new Error('secret-marker'), known), null)
  assert.equal(knownErrorCode(new Error('prefix_analysis_not_found_suffix'), known), null)
})
