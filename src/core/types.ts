export type Agent = 'codex' | 'pi' | 'cursor'
export type Effort = 'off' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface Profile {
  id: string
  agent: Agent
  model: string
  effort: Effort | null
  description: string
  operatorConfirmed: boolean
}
export interface Config {
  version: 1
  profiles: Profile[]
  fallback: string
  live: boolean
  execution: boolean
  budgetMicrousd: number
  maxCalls: number
}
export interface Ledger { calls: number; reservedMicrousd: number }
export interface Workspace { id: string; path: string; host: 'local' }
export interface Evidence { verified: boolean; source: string }
export interface Plan {
  id: string; profile: Profile; reason: string; confidence: number | null
  createdAt: number; expiresAt: number; configHash: string; taskHash: string; workspaceHash: string
  evidence: Evidence; costUsd: number | null; reservedMicrousd: number
  state: 'shadow' | 'cancelled' | 'dispatch_pending' | 'submitted' | 'dispatch_unknown' | 'dispatch_failed'
  dispatch?: { kind: 'structured' | 'terminal'; handle: string; operationId?: string }
  observedModel: string | null; observedEffort: string | null
}
export interface Store { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
export interface Transport { (url: string, options: { body?: string; key?: string; signal: AbortSignal }): Promise<unknown> }
export interface CommandResult { code: number; stdout: string }
export interface Runtime {
  verify(profile: Profile): Promise<Evidence>
  launch(profile: Profile, task: string, workspace: Workspace): Promise<CommandResult>
}
