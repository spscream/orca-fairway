import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountBalance, keyBalance, Balances, balanceTransport, CREDITS_URL, KEY_URL, type BalanceTransport } from '../src/core/balance.ts'
test('account funds and key limits are separate; null limit never means unlimited account funds', () => {
  assert.deepEqual(accountBalance({ data: { total_credits: 100.5, total_usage: 25.75 } }), { state: 'available', remainingUsd: 74.75 })
  assert.equal(accountBalance({ data: { total_credits: 0, total_usage: 1 } }).remainingUsd, -1)
  assert.deepEqual(keyBalance({ data: { limit: 10, limit_remaining: 3 } }), { state: 'available', remainingUsd: 3 })
  assert.deepEqual(keyBalance({ data: { limit: null, limit_remaining: null } }), { state: 'unlimited', remainingUsd: null })
  for (const value of [null, {}, { data: {} }, { data: { total_credits: '10', total_usage: 1 } }, { data: { total_credits: Infinity, total_usage: 0 } }]) assert.throws(() => accountBalance(value))
  for (const value of [{ data: {} }, { data: { limit: null } }, { data: { limit: 10, limit_remaining: NaN } }, { data: { limit: 1, limit_remaining: 2 } }]) assert.throws(() => keyBalance(value))
})
test('balance construction and cache reads are offline; missing key never sends a request', async () => {
  let requests = 0, keys = 0
  const balances = new Balances(async () => { keys++; return null }, async () => { requests++; throw new Error('must not request') })
  assert.equal(balances.cached(), null); assert.equal(keys, 0)
  const result = await balances.refresh()
  assert.equal(result.account.state, 'missing_key'); assert.equal(result.key.state, 'missing_key'); assert.equal(requests, 0)
})
test('a restricted account query preserves a valid ordinary-key limit without exposing identity', async () => {
  const balances = new Balances(async () => 'synthetic-secret', async url => url === CREDITS_URL
    ? { status: 403 } : { status: 200, value: { data: { limit: 10, limit_remaining: 4, label: 'synthetic-secret', creator_user_id: 'private-identity' } } })
  const result = await balances.refresh()
  assert.deepEqual(result.account, { state: 'restricted', remainingUsd: null })
  assert.equal(result.key.remainingUsd, 4)
  assert.ok(!JSON.stringify(result).includes('synthetic-secret')); assert.ok(!JSON.stringify(result).includes('private-identity'))
})
test('concurrent refreshes share at most two GETs and the 30-second cache is invalidated explicitly', async () => {
  let requests = 0, now = 100000
  const balances = new Balances(async () => 'synthetic', async url => { requests++; return { status: 200, value: { data: url === CREDITS_URL ? { total_credits: 50, total_usage: 20 } : { limit: null, limit_remaining: null } } } }, 1000, () => now)
  const results = await Promise.all(Array.from({ length: 5 }, () => balances.refresh()))
  assert.equal(requests, 2); assert.equal(results[0]!.account.remainingUsd, 30)
  now += 29999; await balances.refresh(); assert.equal(requests, 2)
  now++; await balances.refresh(); assert.equal(requests, 4)
  balances.invalidate(); assert.equal(balances.cached(), null); await balances.refresh(); assert.equal(requests, 6)
})
test('errors and malformed data never become zero funds or leak exception text', async () => {
  for (const status of [401, 429, 500]) {
    const balances = new Balances(async () => 'synthetic', async () => ({ status }))
    const result = await balances.refresh()
    assert.equal(result.account.state, status === 401 ? 'invalid_key' : 'unavailable'); assert.equal(result.account.remainingUsd, null)
  }
  const malformed = new Balances(async () => 'synthetic', async () => ({ status: 200, value: { data: {} } }))
  assert.equal((await malformed.refresh()).account.state, 'unavailable')
  const failing = new Balances(async () => 'synthetic', async () => { throw new Error('secret-exception-marker') })
  assert.ok(!JSON.stringify(await failing.refresh()).includes('secret-exception-marker'))
  const connectTimeout = new Balances(async () => 'synthetic', async () => { throw Object.assign(new Error('hidden'), { cause: { code: 'ETIMEDOUT' } }) })
  assert.equal((await connectTimeout.refresh()).account.state, 'timeout')
})
test('hung balance transport has a bounded timeout without retries', async () => {
  let requests = 0
  const balances = new Balances(async () => 'synthetic', async () => { requests++; return new Promise(() => {}) }, 10)
  const hold = setInterval(() => {}, 1000)
  try { const result = await balances.refresh(); assert.equal(result.account.state, 'timeout'); assert.equal(result.key.state, 'timeout'); assert.equal(requests, 2) }
  finally { clearInterval(hold) }
})
test('key rotation aborts an old request and cannot repopulate its cache', async () => {
  let key = 'old-synthetic', unblock: (() => void) | undefined
  const transport: BalanceTransport = async (_url, provided) => {
    if (provided === 'old-synthetic') await new Promise<void>(resolve => { unblock = resolve })
    return { status: 401 }
  }
  const balances = new Balances(async () => key, transport)
  const old = balances.refresh(); const rejected = assert.rejects(old, /balance_cancelled/)
  while (!unblock) await new Promise(r => setImmediate(r))
  key = 'new-synthetic'; balances.invalidate()
  await rejected; const latest = await balances.refresh(); unblock()
  assert.equal(latest.account.state, 'invalid_key'); assert.equal(balances.cached(), latest)
})
test('balance transport uses fixed GET endpoints, refuses redirects and bounds response bodies', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), CREDITS_URL); assert.equal(options?.method, 'GET'); assert.equal(options?.body, undefined)
      assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store')
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer synthetic')
      return new Response('{"data":{"total_credits":10,"total_usage":2}}', { status: 200 })
    }
    assert.equal((await balanceTransport(CREDITS_URL, 'synthetic', new AbortController().signal)).status, 200)
    await assert.rejects(balanceTransport('https://example.invalid', 'synthetic', new AbortController().signal), /endpoint_refused/)
    globalThis.fetch = async () => new Response('x'.repeat(16385), { status: 200 })
    await assert.rejects(balanceTransport(KEY_URL, 'synthetic', new AbortController().signal), /response_too_large/)
  } finally { globalThis.fetch = original }
})
test('secret-store failure and timeout are bounded and never expose exception details', async () => {
  const failing = new Balances(async () => { throw new Error('private-secret-marker') })
  const result = await failing.refresh(); assert.equal(result.account.state, 'unavailable'); assert.ok(!JSON.stringify(result).includes('private-secret-marker'))
  const hung = new Balances(async () => new Promise(() => {}), async () => { throw new Error('must not reach network') }, 10)
  const hold = setInterval(() => {}, 1000)
  try { assert.equal((await hung.refresh()).account.state, 'timeout') } finally { clearInterval(hold) }
})
