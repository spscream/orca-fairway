import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker.ts'
import { DEFAULT_CONFIG } from './core/config.ts'
import type { Runtime } from './core/types.ts'
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
