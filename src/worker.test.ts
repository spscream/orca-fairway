import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker.ts'
import { DEFAULT_CONFIG } from './core/config.ts'
import type { Runtime } from './core/types.ts'
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
