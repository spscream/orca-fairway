import type { Config, Ledger, Plan, Agent } from './core/types.ts'
import type { Workflow } from './core/workflow.ts'
export type WorkflowAction = 'launchCoordinator' | 'read' | 'approve' | 'route' | 'launch' | 'review' | 'cancel'
export interface Status { config: Config; ledger: Ledger; keyPresent: boolean; workspace: string | null; lastPlan: Plan | null; bridgePath: string | null; workflow: Workflow | null }
export {}
declare module 'orca' {
  interface PluginRequests {
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
