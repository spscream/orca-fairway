import type { Config, Ledger, Plan, Agent } from './core/types.ts'
import type { Workflow, AnalysisInspection } from './core/workflow.ts'
import type { BalanceSnapshot } from './core/balance.ts'
export type WorkflowAction = 'startAutomatic' | 'pauseAutomatic' | 'refreshCoordinator' | 'launchCoordinator' | 'read' | 'approve' | 'route' | 'launch' | 'inspectResult' | 'review' | 'cancel'
export interface Status { config: Config; ledger: Ledger; keyPresent: boolean; workspace: string | null; lastPlan: Plan | null; bridgePath: string | null; workflow: Workflow | null; balance: BalanceSnapshot | null }
export {}
declare module 'orca' {
  interface PluginRequests {
    'fairway.balance': { output: BalanceSnapshot }
    'fairway.workflow.inspect': { input: { id: string }; output: AnalysisInspection }
    'fairway.workflow.create': { input: { task: string; profileId: string }; output: Workflow }
    'fairway.workflow.action': { input: { id: string; action: WorkflowAction; stepId?: string; review?: string }; output: Workflow }
    'fairway.status': { output: Status }
    'fairway.history': { output: { json: string } }
    'fairway.config': { input: { config: string }; output: Status }
    'fairway.key': { input: { key: string }; output: { present: boolean } }
    'fairway.plan': { input: { id: string; task: string; agent: Agent }; output: Plan }
    'fairway.cancel': { input: { id: string }; output: { cancelled: true } }
    'fairway.launch': { input: { id: string; task: string }; output: Plan }
    'fairway.bridge': { input: { enabled: boolean }; output: { path: string | null } }
  }
}
