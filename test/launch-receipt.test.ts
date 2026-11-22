import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchReceipt } from '../src/core/launch-receipt.ts'
const launch = { outcome: { kind: 'structured', handle: 'orca_session_id:synthetic' }, prompt: { outcome: 'journaled', text: 'private-prompt-marker' }, receipt: { detail: 'private-response-marker' } }
test('current agent launch receipt is direct and retains only dispatch identifiers', () => {
  const parsed = launchReceipt({ ok: true, result: { ...launch, operationId: 'synthetic-operation' } })
  assert.deepEqual(parsed, { kind: 'structured', handle: 'orca_session_id:synthetic', operationId: 'synthetic-operation' })
  assert.ok(!JSON.stringify(parsed).includes('private-'))
})
test('wrapped worktree-style receipts and terminal prompt delivery are recognized', () => {
  assert.equal(launchReceipt({ ok: true, result: { launch } })?.handle, 'orca_session_id:synthetic')
  assert.equal(launchReceipt({ ok: true, result: { outcome: { kind: 'terminal', handle: 'term_synthetic' }, prompt: { outcome: 'handed-to-terminal' } } })?.kind, 'terminal')
})
test('failed, incomplete, undelivered and injected receipts never confirm submission', () => {
  for (const value of [null, {}, { ok: false, result: launch }, { ok: true, result: { launch: {} } },
    { ok: true, result: { ...launch, prompt: { outcome: 'pending' } } },
    { ok: true, result: { ...launch, outcome: { kind: 'structured', handle: 'handle\nprivate-marker' } } },
    { ok: true, result: { ...launch, outcome: { kind: 'unknown', handle: 'synthetic' } } }]) assert.equal(launchReceipt(value), null)
})
