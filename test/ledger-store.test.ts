import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../src/core/config.ts'
import { Engine } from '../src/core/engine.ts'
import { withDiskLedger } from '../src/core/ledger-store.ts'
import { RESERVATION_MICROUSD } from '../src/core/limits.ts'
import type { Runtime, Store, Transport } from '../src/core/types.ts'

test('independent stores share one durable JEV reservation and a missing migrated ledger fails closed', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'fairway-ledger-'))
  const config = { ...DEFAULT_CONFIG, live: true, maxCalls: 2 }
  const host = () => {
    const values = new Map<string, unknown>([['config', config], ['ledger', { calls: 1, reservedMicrousd: RESERVATION_MICROUSD }]])
    return { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value) } } satisfies Store
  }
  const a = host(), b = host()
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { throw new Error('unexpected') } }
  let decisions = 0
  const transport: Transport = async (_url, opts) => {
    if (!opts.body) return { data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '0.000000042', completion: '0' } } }
    decisions++
    return { answers: { profile: { type: 'choice', choice: 'standard', confidence: 1, probabilities: { routine: 0, standard: 1, deep: 0 } } }, usage: { cost: 0 } }
  }
  const workspace = { id: 'synthetic', path: '/synthetic', host: 'local' as const }
  try {
    const engines = [a, b].map(store => new Engine(withDiskLedger(store, directory), runtime, async () => 'synthetic-key', transport))
    const plans = await Promise.all(engines.map(engine => engine.plan('Synthetic task', 'codex', workspace)))
    assert.deepEqual(plans.map(p => p.reason).sort(), ['budget_exhausted', 'selected'])
    assert.equal(decisions, 1)
    for (const engine of engines) assert.deepEqual({ ...await engine.ledger() }, { calls: 2, reservedMicrousd: 2 * RESERVATION_MICROUSD })
    await unlink(join(directory, 'ledger.json'))
    for (const engine of engines) await assert.rejects(engine.ledger(), /invalid_ledger/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('two independent Node processes serialize reservations against the same file', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'fairway-process-ledger-'))
  const script = `
    import { withDiskLedger } from ${JSON.stringify(new URL('../src/core/ledger-store.ts', import.meta.url).href)}
    import { setTimeout } from 'node:timers/promises'
    const memory = new Map()
    const store = withDiskLedger({ get: async k => memory.get(k) ?? null, set: async (k, v) => { memory.set(k, v) } }, process.argv[1])
    const reserved = await store.exclusive(async () => {
      if ((await store.get('ledger'))?.calls) return false
      await setTimeout(75)
      await store.set('ledger', { calls: 1, reservedMicrousd: 13108 })
      return true
    })
    console.log(reserved ? 'reserved' : 'blocked')
  `
  try {
    const run = () => promisify(execFile)(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script, directory], { timeout: 8000 })
    const results = await Promise.all([run(), run()])
    assert.deepEqual(results.map(result => result.stdout.trim()).sort(), ['blocked', 'reserved'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('two routing processes compete for one reservation before transport', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'fairway-routing-race-'))
  const script = `
    import { Engine } from ${JSON.stringify(new URL('../src/core/engine.ts', import.meta.url).href)}
    import { DEFAULT_CONFIG } from ${JSON.stringify(new URL('../src/core/config.ts', import.meta.url).href)}
    import { withDiskLedger } from ${JSON.stringify(new URL('../src/core/ledger-store.ts', import.meta.url).href)}
    import { readdir, writeFile } from 'node:fs/promises'
    import { setTimeout } from 'node:timers/promises'
    const [directory, participant] = process.argv.slice(1)
    const values = new Map([['config', { ...DEFAULT_CONFIG, live: true, maxCalls: 1 }]])
    const store = withDiskLedger({ get: async k => values.get(k) ?? null, set: async (k, v) => { values.set(k, v) } }, directory)
    let metadata = 0, decisions = 0
    const engine = new Engine(store, { verify: async () => ({ verified: true, source: 'synthetic' }) }, async () => 'synthetic', async (_url, opts) => {
      if (!opts.body) {
        metadata++
        return { data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '0.000000042', completion: '0' } } }
      }
      decisions++
      return { answers: { profile: { type: 'choice', choice: 'standard', confidence: 1, probabilities: { routine: 0, standard: 1, deep: 0 } } }, usage: { cost: 0 } }
    })
    await writeFile(directory + '/ready-' + participant, '')
    while ((await readdir(directory)).filter(name => name.startsWith('ready-')).length < 2) await setTimeout(5)
    const plan = await engine.plan('Synthetic task', 'codex', { id: 'synthetic', path: '/synthetic', host: 'local' })
    console.log(JSON.stringify({ reason: plan.reason, metadata, decisions }))
  `
  try {
    const run = (id: string) => promisify(execFile)(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script, directory, id], { timeout: 8000 })
    const results = await Promise.all([run('a'), run('b')])
    assert.deepEqual(results.map(r => JSON.parse(r.stdout)).sort((a, b) => a.reason.localeCompare(b.reason)), [
      { reason: 'budget_exhausted', metadata: 0, decisions: 0 },
      { reason: 'selected', metadata: 1, decisions: 1 }
    ])
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'ledger.json'), 'utf8')), { calls: 1, reservedMicrousd: RESERVATION_MICROUSD })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
