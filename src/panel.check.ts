import { defineCheck } from 'orca/testing'
import { DEFAULT_CONFIG } from './core/config.ts'
import { digest } from './core/engine.ts'
const workspace = { 'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic project', terminals: [] }, 'workspace.list': { workspaces: [{ id: 'synthetic', kind: 'folder', name: 'Synthetic project', path: '/synthetic-project', branch: null, hostId: 'local' }], truncated: false } }
const plan = { id: 'a'.repeat(36), profile: DEFAULT_CONFIG.profiles[0], reason: 'offline', confidence: null, createdAt: 1, expiresAt: 9999999999999, configHash: digest(DEFAULT_CONFIG), taskHash: '', workspaceHash: '', evidence: { verified: false, source: 'metadata_not_verified' }, costUsd: null, reservedMicrousd: 0, state: 'shadow', observedModel: null, observedEffort: null }
export default defineCheck({
  empty: { results: { 'workspace.readContext': null } },
  ready: { results: workspace },
  recommendation: { results: workspace, storage: { lastPlan: plan as any } },
  settings: { results: workspace, persisted: { plugin: { tab: 'settings' } } },
  pi: { results: workspace, persisted: { plugin: { tab: 'pi' } } }
})
