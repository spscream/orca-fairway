import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticExport, diagnosticHistory } from '../src/core/diagnostics.ts'

test('diagnostic export keeps structured correlation and drops arbitrary metadata', () => {
  const id = 'afd7ca4d-cd71-4a28-921b-ef0dd1edcc08'
  const result = JSON.parse(diagnosticExport([
    { id, at: 2, state: 'automatic_paused', stage: 'observe', reason: 'operation_failed', task: 'synthetic private data', key: 'synthetic credential' },
    { id: 'not-an-id', at: 3, state: 'shadow', reason: 'arbitrary model response' },
    { at: 4, state: 'arbitrary state' },
  ]))
  assert.deepEqual(result, { version: 1, events: [
    { at: 2, state: 'automatic_paused', id, stage: 'observe', reason: 'operation_failed' },
    { at: 3, state: 'shadow' },
  ] })
})

test('history keeps the last 200 valid events in order across damaged entries', () => {
  const history = Array.from({ length: 202 }, (_, at) => ({ at, state: 'planning' }))
  const damaged = [null, 'raw response', { at: -1, state: 'planning' }, { at: 9e15, state: 'planning' }]
  const stored = [...history.slice(0, 100), ...damaged, ...history.slice(100), ...damaged]
  assert.deepEqual(diagnosticHistory(stored), history.slice(-200))
  assert.deepEqual(JSON.parse(diagnosticExport(stored)).events, history.slice(-200))
  assert.deepEqual(diagnosticHistory({ raw: 'unrecognized journal' }), [])
})
