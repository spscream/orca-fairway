import type { OrcaWorkerApi } from 'orca/worker'
import type { JsonValue } from 'orca/host'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseJson } from './core/json.ts'
import { Engine } from './core/engine.ts'
import { NativeRuntime } from './core/runtime.ts'
import { record, requireThat, RouterError } from './core/config.ts'
import { startBridge } from './core/bridge.ts'
import type { Plan, Runtime, Store, Workspace, Transport } from './core/types.ts'
import type { Status } from './protocol.ts'
let stop: (() => Promise<void>) | null = null
export async function deactivate(): Promise<void> { await stop?.(); stop = null }
export function createWorker(runtime: Runtime = new NativeRuntime(), transport?: Transport) {
  return function activate(orca: OrcaWorkerApi): void {
    const store: Store = { get: key => orca.storage.get(key), set: (key, value) => orca.storage.set(key, value as JsonValue) }
    const engine = new Engine(store, runtime, () => orca.secrets.get('openrouter'), transport)
    let bridge: Awaited<ReturnType<typeof startBridge>> | null = null
    stop = async () => { engine.cancelAll(); await bridge?.close(); bridge = null }
    const workspace = async (): Promise<Workspace | null> => {
      const context = await orca.host.call('workspace.readContext')
      if (!context?.workspaceId) return null
      const list = await orca.host.call('workspace.list')
      requireThat(!list.truncated, 'workspace_list_truncated')
      const row = list.workspaces.find(w => w.id === context.workspaceId)
      // Host API 1.10 documents null for local project-group folders.
      if (!row || !(row.hostId === 'local' || (row.kind === 'folder' && row.hostId === null))) return null
      return { id: row.id, path: row.path, host: 'local' }
    }
    const status = async (): Promise<Status> => {
      const w = await workspace()
      return { config: await engine.config(), ledger: await engine.ledger(), keyPresent: !!await orca.secrets.get('openrouter'), workspace: w?.id ?? null, lastPlan: (await store.get('lastPlan') as Plan | null) ?? null, bridgePath: bridge?.path ?? null }
    }
    // Errors expose only fixed codes, never exception strings, task text or child output.
    const safe = <T, R>(action: (input: T) => Promise<R>) => async (input: T): Promise<R> => {
      try { return await action(input) } catch (e) { throw new Error(e instanceof RouterError ? e.code : 'operation_unavailable') }
    }
    orca.panels.handle('fairway.status', safe(status))
    orca.panels.handle('fairway.history', safe(async () => ({ json: JSON.stringify((await engine.history()).slice(-20), null, 2) })))
    orca.panels.handle('fairway.config', safe(async ({ config }) => {
      requireThat(typeof config === 'string' && Buffer.byteLength(config) <= 16_384, 'invalid_config')
      await engine.saveConfig(parseJson(config)); await store.set('lastPlan', null); return status()
    }))
    orca.panels.handle('fairway.key', safe(async ({ key }) => {
      requireThat(typeof key === 'string' && (key === '' || /^[\x21-\x7e]{16,4096}$/.test(key)), 'invalid_key')
      if (key) await orca.secrets.set('openrouter', key); else await orca.secrets.delete('openrouter')
      engine.cancelAll()
      return { present: !!key }
    }))
    orca.panels.handle('fairway.plan', safe(async ({ id, task, agent }) => {
      const w = await workspace(); requireThat(w, 'local_workspace_required')
      const plan = await engine.plan(task, agent, w, id); await store.set('lastPlan', plan); return plan
    }))
    orca.panels.handle('fairway.cancel', safe(async ({ id }) => { await engine.cancel(id); return { cancelled: true as const } }))
    orca.panels.handle('fairway.launch', safe(async ({ id, task }) => {
      const w = await workspace(); requireThat(w, 'local_workspace_required')
      const plan = await engine.launch(id, task, w); await store.set('lastPlan', plan); return plan
    }))
    orca.panels.handle('fairway.bridge', safe(async ({ enabled }) => {
      requireThat(typeof enabled === 'boolean', 'invalid_request')
      if (!enabled) { await bridge?.close(); bridge = null; return { path: null } }
      if (!bridge) bridge = await startBridge(join(homedir(), '.config', 'fairway-for-orca'), async (task, session) => {
        const plan = await engine.plan(task, 'pi', { id: 'pi:' + session, path: '/', host: 'local' })
        requireThat(plan.evidence.verified && plan.state === 'shadow', 'profile_unverified')
        return { profile: { model: plan.profile.model, effort: plan.profile.effort }, reason: plan.reason }
      })
      return { path: bridge.path }
    }))
    orca.commands.register('fairway.status', async () => {
      const c = await engine.config(), l = await engine.ledger()
      return `Fairway: ${c.live ? 'JEV включён' : 'без сети'}, ${c.execution ? 'явный запуск разрешён' : 'наблюдение'}, попыток ${l.calls}/${c.maxCalls}. Откройте панель Fairway.`
    })
  }
}
export default createWorker()
