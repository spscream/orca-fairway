import type { OrcaWorkerApi } from 'orca/worker'
import type { JsonValue } from 'orca/host'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseJson } from './core/json.ts'
import { digest, Engine } from './core/engine.ts'
import { NativeRuntime } from './core/runtime.ts'
import { DEFAULT_CONFIG, record, requireThat, RouterError, validateConfig } from './core/config.ts'
import { preferences, withPreferences } from './core/preferences.ts'
import { startBridge } from './core/bridge.ts'
import { Workflows, type Artifacts } from './core/workflow.ts'
import { PrivateArtifacts } from './core/artifacts.ts'
import { Balances, type BalanceTransport } from './core/balance.ts'
import type { Plan, Runtime, Store, Workspace, Transport } from './core/types.ts'
import type { Status } from './protocol.ts'
let stop: (() => Promise<void>) | null = null
export async function deactivate(): Promise<void> { await stop?.(); stop = null }
export function createWorker(runtime: Runtime = new NativeRuntime(), transport?: Transport, artifacts: Artifacts = new PrivateArtifacts(join(homedir(), '.config', 'fairway-for-orca', 'workflows')), balanceRequest?: BalanceTransport) {
  return async function activate(orca: OrcaWorkerApi): Promise<void> {
    // Preserve 0.1.0 configuration when adopting Orca's native settings.
    if (!await orca.storage.get('nativeSettingsMigrated')) {
      const legacy = await orca.storage.get('config')
      if (legacy) for (const [key, value] of Object.entries(preferences(validateConfig(legacy)))) await orca.settings.set(key, value)
      await orca.storage.set('nativeSettingsMigrated', true)
    }
    const store: Store = {
      get: async key => key === 'config'
        ? withPreferences(validateConfig((await orca.storage.get(key)) ?? DEFAULT_CONFIG), await orca.settings.get())
        : orca.storage.get(key),
      set: async (key, value) => {
        if (key === 'config') for (const [name, setting] of Object.entries(preferences(validateConfig(value)))) await orca.settings.set(name, setting)
        await orca.storage.set(key, value as JsonValue)
      }
    }
    const engine = new Engine(store, runtime, () => orca.secrets.get('openrouter'), transport)
    const workflows = new Workflows(store, engine, artifacts)
    const balances = new Balances(() => orca.secrets.get('openrouter'), balanceRequest)
    let bridge: Awaited<ReturnType<typeof startBridge>> | null = null
    const settingsChanged = orca.settings.onDidChange(() => { engine.cancelAll() })
    stop = async () => { settingsChanged.dispose(); engine.cancelAll(); balances.invalidate(); await bridge?.close(); bridge = null }
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
      const config = await engine.config(), lastPlan = (await store.get('lastPlan') as Plan | null) ?? null
      return { config, ledger: await engine.ledger(), keyPresent: !!await orca.secrets.get('openrouter'), workspace: w?.id ?? null, lastPlan: lastPlan?.configHash === digest(config) ? lastPlan : null, bridgePath: bridge?.path ?? null, workflow: w ? await workflows.current(w) : null, balance: balances.cached() }
    }
    // Errors expose only fixed codes, never exception strings, task text or child output.
    const safe = <T, R>(action: (input: T) => Promise<R>) => async (input: T): Promise<R> => {
      try { return await action(input) } catch (e) {
        const code = e instanceof RouterError ? e.code : 'operation_unavailable'
        throw Object.assign(new Error(code), { code })
      }
    }
    orca.panels.handle('fairway.status', safe(status))
    orca.panels.handle('fairway.balance', safe(() => balances.refresh()))
    orca.panels.handle('fairway.workflow.inspect', safe(async ({ id }) => {
      const w = await workspace(); requireThat(w, 'local_workspace_required')
      return workflows.inspect(id, w)
    }))
    orca.panels.handle('fairway.workflow.create', safe(async ({ task, profileId }) => {
      const w = await workspace(); requireThat(w, 'local_workspace_required')
      return workflows.create(task, profileId, w)
    }))
    orca.panels.handle('fairway.workflow.action', safe(async ({ id, action, stepId, review }) => {
      const w = await workspace(); requireThat(w, 'local_workspace_required')
      if (action === 'launchCoordinator') return workflows.launchCoordinator(id, w)
      if (action === 'refreshCoordinator') return workflows.refreshCoordinator(id, w)
      if (action === 'read') return workflows.read(id, w)
      if (action === 'approve') return workflows.approve(id, w)
      if (action === 'cancel') return workflows.cancel(id, w)
      requireThat(typeof stepId === 'string', 'invalid_workflow')
      if (action === 'route') return workflows.route(id, stepId, w)
      if (action === 'launch') return workflows.launch(id, stepId, w)
      if (action === 'review') return workflows.review(id, stepId, review ?? '', w)
      throw new RouterError('invalid_workflow')
    }))
    orca.panels.handle('fairway.history', safe(async () => ({ json: JSON.stringify((await engine.history()).slice(-20), null, 2) })))
    orca.panels.handle('fairway.config', safe(async ({ config }) => {
      requireThat(typeof config === 'string' && Buffer.byteLength(config) <= 16_384, 'invalid_config')
      await engine.saveConfig(parseJson(config)); await store.set('lastPlan', null); return status()
    }))
    orca.panels.handle('fairway.key', safe(async ({ key }) => {
      requireThat(typeof key === 'string' && (key === '' || /^[\x21-\x7e]{16,4096}$/.test(key)), 'invalid_key')
      balances.invalidate()
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
      return `Fairway: ${c.live ? 'JEV enabled' : 'offline'}, ${c.execution ? 'explicit execution allowed' : 'shadow mode'}, attempts ${l.calls}/${c.maxCalls}. Open the Fairway panel.`
    })
  }
}
export default createWorker()
