import { defineCheck } from 'orca/testing'
import { DEFAULT_CONFIG } from './core/config.ts'
import { digest } from './core/engine.ts'
import type { Analysis, Workflow } from './core/workflow.ts'
import type { Plan } from './core/types.ts'
const workspace = { 'workspace.readContext': { workspaceId: 'synthetic', branch: 'main', displayName: 'Synthetic project', terminals: [] }, 'workspace.list': { workspaces: [{ id: 'synthetic', kind: 'folder', name: 'Synthetic project', path: '/synthetic-project', branch: null, hostId: 'local' }], truncated: false } }
const plan = { id: 'a'.repeat(36), profile: DEFAULT_CONFIG.profiles[0], reason: 'offline', confidence: null, createdAt: 1, expiresAt: 9999999999999, configHash: digest(DEFAULT_CONFIG), taskHash: '', workspaceHash: '', evidence: { verified: false, source: 'metadata_not_verified' }, costUsd: null, reservedMicrousd: 0, state: 'shadow', observedModel: null, observedEffort: null }
const analysis: Analysis = { version: 1, summary: 'Synthetic workflow after reading documentation.', assumptions: [], questions: [], sources: [{ reference: 'https://example.invalid/docs', status: 'read', summary: 'Synthetic requirements.' }], steps: [{ id: 'implement', title: 'Implementation', instructions: 'Perform a synthetic subtask.', acceptance: 'Synthetic checks passed.', context: 'Documentation context.', routingBrief: 'Small local change with direct verification.', allowedAgents: ['codex', 'pi', 'cursor'], dependsOn: [] }] }
function flowScenario(mode: 'questions' | 'planned' | 'unknown') {
  const w: Workflow = { id: 'b'.repeat(36), workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, task: 'Synthetic https://example.invalid/docs', artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic coordinator prompt', coordinator: { ...plan, state: 'submitted' } as Plan, analysis: structuredClone(analysis), approvedHash: null, cancelled: false, runs: {} }
  if (mode === 'questions') w.analysis!.questions.push('How should the synthetic result be verified?')
  else { w.approvedHash = digest(w.analysis); w.runs.implement = { state: mode === 'planned' ? 'planned' : 'dispatch_unknown', plan: { ...plan, evidence: { verified: true, source: 'synthetic_metadata' } } as Plan, review: null } }
  return { results: workspace, storage: { ['workflowCurrent:' + digest(w.workspace)]: w.id, ['workflow:' + w.id]: w as any }, persisted: { plugin: { tab: 'workflow' } } }
}
export default defineCheck({
  empty: { results: { 'workspace.readContext': null } },
  ready: { results: workspace },
  recommendation: { results: workspace, storage: { lastPlan: plan as any } },
  settings: { results: workspace, persisted: { plugin: { tab: 'settings' } } },
  pi: { results: workspace, persisted: { plugin: { tab: 'pi' } } },
  workflowEmpty: { results: workspace, persisted: { plugin: { tab: 'workflow' } } },
  workflowQuestions: flowScenario('questions'), workflowPlanned: flowScenario('planned'), workflowUnknown: flowScenario('unknown')
})
