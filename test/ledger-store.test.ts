import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, unlink } from 'node:fs/promises'
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
