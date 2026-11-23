import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker.ts'
import { DEFAULT_CONFIG } from './core/config.ts'
import type { Runtime, Transport } from './core/types.ts'
import type { OrcaWorkerApi } from 'orca/worker'
import { randomUUID } from 'node:crypto'
test('worker status never starts a CLI or network operation', async () => {
  let launches = 0, verifications = 0
  const runtime: Runtime = { verify: async () => { verifications++; return { verified: true, source: 'synthetic' } }, launch: async () => { launches++; return { code: 0, stdout: '' } } }
  const host = mockHost({ storage: { config: DEFAULT_CONFIG as any }, results: { 'workspace.readContext': null } })
  const worker = await mountWorker({ default: createWorker(runtime) }, { host })
  const status: any = await worker.request('fairway.status')
  assert.equal(status.config.execution, false); assert.equal(status.config.live, false)
  assert.equal(launches, 0); assert.equal(verifications, 0)
  assert.deepEqual(worker.logs, []); assert.deepEqual(worker.refusals, []); await worker.deactivate()
})
test('diagnostic history survives worker restart, repairs a damaged entry and stays bounded', async () => {
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { throw new Error('must not launch') } }
  const transport: Transport = async (_url, { body }) => body ? { raw: 'new raw service response' } : {
    data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '0.000000042', completion: '0' } },
  }
  const flowId = randomUUID(), requestId = randomUUID(), nextId = randomUUID()
  const legacy = Array.from({ length: 198 }, (_, at) => ({ at, state: 'planning' }))
  const left = { at: 198, state: 'automatic_paused', flowId, reason: 'checks_failed', stage: 'report' }
  const right = { at: 200, state: 'shadow', id: randomUUID(), reason: 'offline' }
  const host = mockHost({
    secrets: { openrouter: 'new synthetic credential' },
    settings: { live: true },
    storage: { nativeSettingsMigrated: true, audit: [...legacy, { ...left, stepId: 'private-step-name', task: 'private task text' },
      { at: 'damaged', state: 'shadow', response: 'raw service response' }, { ...right, key: 'private credential' }] },
    results: {
      'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'synthetic', kind: 'folder', name: 'Synthetic', path: '/synthetic-project', branch: null, hostId: null }], truncated: false },
    },
  })
  let worker = await mountWorker({ default: createWorker(runtime, transport) }, { host })
  try {
    const view = async () => {
      const { json, exportJson } = await worker.request('fairway.history') as { json: string; exportJson: string }
      const exported = JSON.parse(exportJson)
      assert.equal(exported.version, 1)
      assert.deepEqual(JSON.parse(json), exported.events.slice(-20))
      return exported.events
    }
    assert.deepEqual(await view(), [...legacy, left, right])
    await worker.request('fairway.plan', { id: requestId, task: 'new private task text', agent: 'codex' })
    const saved = await view()
    assert.equal(saved.length, 200)
    assert.deepEqual(saved.slice(0, -2), [...legacy.slice(2), left, right])
    const newEvents = saved.slice(-2)
    assert.ok(newEvents.every(({ at }: { at: number }) => at > 200))
    assert.deepEqual(newEvents.map(({ at, ...event }: { at: number }) => event), [
      { state: 'planning', id: requestId },
      { state: 'shadow', id: requestId, reason: 'invalid_response' },
    ])
    assert.deepEqual(host.data().storage.audit, saved)
    await worker.deactivate()
    worker = await mountWorker({ default: createWorker(runtime, transport) }, { host })
    assert.deepEqual(await view(), saved)
    await worker.request('fairway.plan', { id: nextId, task: 'second private task text', agent: 'codex' })
    const updated = await view()
    assert.equal(updated.length, 200)
    assert.deepEqual(updated.slice(0, -2), saved.slice(2))
    assert.equal(updated.at(-1).id, nextId)
    assert.deepEqual(host.data().storage.audit, updated)
  } finally { await worker.deactivate() }
})
test('a non-array diagnostic journal can be replaced by new events', async () => {
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { throw new Error('must not launch') } }
  const host = mockHost({ storage: { audit: 'damaged journal' }, results: {
    'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'synthetic', kind: 'folder', name: 'Synthetic', path: '/synthetic-project', branch: null, hostId: null }], truncated: false },
  } })
  const worker = await mountWorker({ default: createWorker(runtime) }, { host })
  try {
    const empty = await worker.request('fairway.history') as { json: string }
    assert.deepEqual(JSON.parse(empty.json), [])
    const id = randomUUID()
    await worker.request('fairway.plan', { id, task: 'private task text', agent: 'codex' })
    const saved = await worker.request('fairway.history') as { exportJson: string }
    const { events } = JSON.parse(saved.exportJson)
    assert.deepEqual(events.map((event: { id: string; state: string }) => [event.id, event.state]), [[id, 'planning'], [id, 'shadow']])
    assert.deepEqual(host.data().storage.audit, events)
  } finally { await worker.deactivate() }
})
test('local group folders with null host are supported; remote workspaces are refused', async () => {
  const runtime: Runtime = { verify: async () => ({ verified: false, source: 'synthetic' }), launch: async () => { throw new Error('must not launch') } }
  for (const [kind, hostId, expected] of [['folder', null, 'synthetic'], ['worktree', 'local', 'synthetic'], ['folder', 'ssh:synthetic', null], ['worktree', null, null]] as const) {
    const host = mockHost({ results: {
      'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'synthetic', kind, name: 'Synthetic', path: '/synthetic-project', branch: null, hostId }], truncated: false }
    } })
    const worker = await mountWorker({ default: createWorker(runtime) }, { host })
    assert.equal((await worker.request('fairway.status') as any).workspace, expected)
    assert.deepEqual(worker.refusals, []); await worker.deactivate()
  }
})
test('native settings migrate once, share the panel configuration and preserve accounting', async () => {
  let api!: OrcaWorkerApi, launches = 0
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { launches++; return { code: 0, stdout: '' } } }
  const legacy = { ...DEFAULT_CONFIG, budgetMicrousd: 420000, maxCalls: 9 }
  const host = mockHost({ storage: { config: legacy as any, ledger: { calls: 2, reservedMicrousd: 26216 } }, results: { 'workspace.readContext': null } })
  const worker = await mountWorker({ default: async (orca: OrcaWorkerApi) => { api = orca; await createWorker(runtime)(orca) } }, { host })
  assert.equal(host.data().settings.budgetUsd, .42)
  await api.settings.set('budgetUsd', .25); await api.settings.set('maxCalls', 4)
  const current: any = await worker.request('fairway.status')
  assert.equal(current.config.budgetMicrousd, 250000); assert.equal(current.config.maxCalls, 4)
  assert.equal(current.ledger.calls, 2)
  await worker.request('fairway.config', { config: JSON.stringify({ ...current.config, budgetMicrousd: 300000 }) })
  assert.equal(host.data().settings.budgetUsd, .3)
  await worker.deactivate()
  await api.settings.set('maxCalls', 3)
  const restarted = await mountWorker({ default: createWorker(runtime) }, { host })
  assert.equal((await restarted.request('fairway.status') as any).config.maxCalls, 3)
  assert.equal(launches, 0); assert.deepEqual(restarted.refusals, []); await restarted.deactivate()
})
test('turning execution off in native settings blocks a launch waiting on verification', async () => {
  let api!: OrcaWorkerApi, unblock: (() => void) | undefined, launches = 0
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { launches++; return { code: 0, stdout: '' } } }
  const host = mockHost({ storage: { config: { ...DEFAULT_CONFIG, execution: true } as any }, results: {
    'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'synthetic', kind: 'folder', name: 'Synthetic', path: '/synthetic-project', branch: null, hostId: 'local' }], truncated: false }
  } })
  const worker = await mountWorker({ default: async (orca: OrcaWorkerApi) => { api = orca; await createWorker(runtime)(orca) } }, { host })
  const plan: any = await worker.request('fairway.plan', { id: randomUUID(), task: 'Synthetic task', agent: 'codex' })
  assert.equal((await worker.request('fairway.status') as any).lastPlan.id, plan.id)
  runtime.verify = async () => { await new Promise<void>(r => { unblock = r }); return { verified: true, source: 'synthetic' } }
  const launching = worker.request('fairway.launch', { id: plan.id, task: 'Synthetic task' })
  while (!unblock) await new Promise(r => setImmediate(r))
  await api.settings.set('execution', false); unblock()
  await assert.rejects(launching, /plan_changed/); assert.equal(launches, 0)
  assert.equal((await worker.request('fairway.status') as any).lastPlan, null)
  assert.deepEqual(worker.refusals, []); await worker.deactivate()
})
test('workflow handlers connect synthetic analysis, cross-agent routing and guarded dispatch', async () => {
  let launches = 0
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { launches++; return { code: 0, stdout: '{"ok":true,"result":{"outcome":{"kind":"structured","handle":"orca_session_id:synthetic"},"prompt":{"outcome":"journaled"}}}' } } }
  let raw = JSON.stringify({ version: 1, summary: 'Synthetic', assumptions: [], questions: [], sources: [], steps: [{ id: 'check', title: 'Synthetic check', instructions: 'Inspect synthetic result', acceptance: 'Synthetic check passes', context: '', routingBrief: 'Small synthetic check', allowedAgents: ['codex'], dependsOn: [] }] })
  const host = mockHost({ results: {
    'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'synthetic', kind: 'folder', name: 'Synthetic', path: '/synthetic-project', branch: null, hostId: 'local' }], truncated: false }
  } })
  const worker = await mountWorker({ default: createWorker(runtime, undefined, { create: async () => '/synthetic-private/analysis.json', read: async () => raw }) }, { host })
  const w: any = await worker.request('fairway.workflow.create', { task: 'Synthetic', profileId: 'standard' })
  raw = JSON.stringify({ ...JSON.parse(raw), coordinatorPlanId: w.coordinator.id })
  await worker.request('fairway.workflow.action', { id: w.id, action: 'read' })
  await worker.request('fairway.workflow.action', { id: w.id, action: 'approve' })
  const planned: any = await worker.request('fairway.workflow.action', { id: w.id, action: 'route', stepId: 'check' })
  assert.equal(planned.runs.check.plan.profile.agent, 'codex')
  await assert.rejects(worker.request('fairway.workflow.action', { id: 'invalid', action: 'read' }), (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'invalid_workflow')
  await assert.rejects(worker.request('fairway.workflow.action', { id: w.id, action: 'launch', stepId: 'check' }), /execution_disabled/)
  assert.equal(launches, 0); assert.deepEqual(worker.refusals, []); await worker.deactivate()
})
test('explicit balance refresh is read-only, cached and cleared when the own key changes', async () => {
  let requests = 0, launches = 0, decisions = 0
  const runtime: Runtime = { verify: async () => ({ verified: false, source: 'synthetic' }), launch: async () => { launches++; throw new Error('must not launch') } }
  const host = mockHost({ secrets: { openrouter: 'synthetic-secret-123456' }, storage: { ledger: { calls: 2, reservedMicrousd: 26216 } }, results: { 'workspace.readContext': null } })
  const worker = await mountWorker({ default: createWorker(runtime, async () => { decisions++; throw new Error('must not decide') }, undefined, async () => { requests++; return { status: 403 } }) }, { host })
  assert.equal((await worker.request('fairway.status') as any).balance, null); assert.equal(requests, 0)
  const result: any = await worker.request('fairway.balance')
  assert.equal(result.account.state, 'restricted'); assert.equal(requests, 2)
  assert.equal((await worker.request('fairway.status') as any).ledger.calls, 2)
  await worker.request('fairway.balance'); assert.equal(requests, 2)
  await worker.request('fairway.key', { key: '' })
  assert.equal((await worker.request('fairway.status') as any).balance, null)
  assert.equal((await worker.request('fairway.balance') as any).account.state, 'missing_key')
  assert.equal(launches, 0); assert.equal(decisions, 0); assert.deepEqual(worker.logs, []); assert.deepEqual(worker.refusals, [])
  assert.ok(!JSON.stringify(result).includes('synthetic-secret')); await worker.deactivate()
})
test('enabling unlimited JEV through native preferences preserves accounting and never starts work on activation', async () => {
  let launches = 0
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async () => { launches++; throw new Error('unexpected launch') } }
  const host = mockHost({ storage: { config: DEFAULT_CONFIG as any, ledger: { calls: 5, reservedMicrousd: 65540 } }, results: { 'workspace.readContext': null } })
  let worker = await mountWorker({ default: createWorker(runtime) }, { host })
  const current: any = await worker.request('fairway.status')
  assert.equal(current.config.unlimitedJev, false)
  await worker.request('fairway.config', { config: JSON.stringify({ ...current.config, unlimitedJev: true }) })
  assert.equal(host.data().settings.unlimitedJev, true)
  await worker.deactivate(); worker = await mountWorker({ default: createWorker(runtime) }, { host })
  const restarted: any = await worker.request('fairway.status')
  assert.equal(restarted.config.unlimitedJev, true); assert.equal(restarted.ledger.calls, 5); assert.equal(restarted.ledger.reservedMicrousd, 65540)
  assert.equal(launches, 0); await worker.deactivate()
})
