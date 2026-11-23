import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startBridge } from '../src/core/bridge.ts'
import { askFairway, createPiExtension } from '../adapters/pi.ts'

test('local bridge authenticates, rejects browser origins and has no dispatch endpoint', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-bridge-'))
  const seen: string[] = []
  const bridge = await startBridge(join(root, 'connection'), async task => { seen.push(task); return { profile: { model: 'synthetic/model', effort: 'low' } } })
  try {
    const conn = JSON.parse(await readFile(bridge.path, 'utf8'))
    const headers = { Authorization: 'Bearer ' + conn.token, 'Content-Type': 'application/json' }
    assert.equal((await fetch(conn.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
    assert.equal((await fetch(conn.endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://synthetic.invalid' }, body: '{}' })).status, 403)
    assert.equal((await fetch(conn.endpoint.replace('/decisions', '/launch'), { method: 'POST', headers, body: '{}' })).status, 403)
    assert.deepEqual(await askFairway('Synthetic brief only', new AbortController().signal, bridge.path), { model: 'synthetic/model', effort: 'low' })
    assert.deepEqual(seen, ['Synthetic brief only'])
    assert.equal((await stat(bridge.path)).mode & 0o077, 0)
    await assert.rejects(startBridge(join(root, 'connection'), async () => null))
  } finally { await bridge.close(); await rm(root, { recursive: true, force: true }) }
})
test('Pi connection rejects external endpoints before sending its local token', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-bridge-')); const path = join(root, 'connection.json')
  try {
    await writeFile(path, JSON.stringify({ version: 1, endpoint: 'https://synthetic.invalid/v1/decisions', token: 'a'.repeat(64), expiresAt: Date.now() + 10000 }), { mode: 0o600 })
    await assert.rejects(askFairway('Synthetic', new AbortController().signal, path), /unavailable/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('Pi uses only an explicit brief and pins the physical pair across continuations', async () => {
  let definition: any, command: any; const seen: string[] = []
  createPiExtension(async task => { seen.push(task); return { model: 'synthetic/model', effort: 'medium' } })({
    registerCommand: (_name, options) => { command = options }, registerVirtualModel: d => { definition = d }
  })
  const model = { provider: 'synthetic', id: 'model' }, ctx = { modelRegistry: { find: () => model } }
  const request = { reason: 'user', signal: new AbortController().signal, messages: [{ role: 'user', content: 'Synthetic expanded source marker — do not send' }] }
  await assert.rejects(definition.route(request, ctx), /fairway-brief/); assert.equal(seen.length, 0)
  await command.handler('Synthetic sanitized brief')
  const first = await definition.route(request, ctx)
  assert.deepEqual(seen, ['Synthetic sanitized brief']); assert.equal(first.thinkingLevel, 'medium')
  const second = await definition.route({ ...request, reason: 'continuation', state: first.state }, ctx)
  assert.equal(second.model.id, 'model'); assert.equal(seen.length, 1)
  const resumed = await definition.route({ ...request, state: first.state }, ctx)
  assert.equal(resumed.thinkingLevel, 'medium'); assert.equal(seen.length, 1)
})
test('Pi refuses an absent runtime model without calling an executor', async () => {
  let definition: any, command: any
  createPiExtension(async () => ({ model: 'synthetic/unavailable', effort: 'high' }))({ registerCommand: (_n, opts) => { command = opts }, registerVirtualModel: d => { definition = d } })
  await command.handler('Synthetic task')
  await assert.rejects(definition.route({ reason: 'user', signal: new AbortController().signal, messages: [] }, { modelRegistry: { find: () => undefined } }), /not in the Pi catalog/)
})

test('closing the Pi bridge aborts an ongoing decision and allows a clean restart', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-bridge-'))
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  let signal!: AbortSignal
  const bridge = await startBridge(root, async (_task, _session, requestSignal) => {
    signal = requestSignal
    started()
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    return null
  })
  try {
    const request = askFairway('Synthetic brief', new AbortController().signal, bridge.path).catch(error => error)
    await entered
    await Promise.all([bridge.close(), bridge.close()])
    assert.equal(signal.aborted, true)
    assert.ok(await request instanceof Error)
    const reopened = await startBridge(root, async () => null)
    await reopened.close()
  } finally { await bridge.close(); await rm(root, { recursive: true, force: true }) }
})

test('a Pi brief is consumed before routing and a concurrent turn cannot reuse it', async () => {
  let definition: any, command: any, finish!: () => void
  let requests = 0
  createPiExtension(async () => {
    requests++
    await new Promise<void>(resolve => { finish = resolve })
    return { model: 'synthetic/model', effort: 'low' }
  })({ registerCommand: (_n, opts) => { command = opts }, registerVirtualModel: d => { definition = d } })
  const request = { reason: 'user', signal: new AbortController().signal, messages: [] }
  const ctx = { modelRegistry: { find: () => ({ provider: 'synthetic', id: 'model' }) } }
  await command.handler('Synthetic brief')
  const first = definition.route(request, ctx)
  await assert.rejects(definition.route(request, ctx), /fairway-brief/)
  finish(); await first
  assert.equal(requests, 1)
})
