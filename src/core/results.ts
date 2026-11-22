import { record, requireThat } from './config.ts'
import type { StepRun } from './workflow.ts'
export interface StepResult {
  version: 1; workflowId: string; stepId: string; planId: string; token: string
  status: 'completed' | 'blocked' | 'failed'; summary: string
  checks: { name: string; status: 'passed' | 'failed'; evidence: string }[]; questions: string[]
}
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',')
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= max
export function validateStepResult(value: unknown, workflowId: string, stepId: string, run: StepRun): StepResult {
  requireThat(record(value) && exact(value, ['version', 'workflowId', 'stepId', 'planId', 'token', 'status', 'summary', 'checks', 'questions']), 'invalid_step_result')
  requireThat(run.plan && run.result, 'invalid_step_result')
  requireThat(value.version === 1 && value.workflowId === workflowId && value.stepId === stepId && value.planId === run.plan?.id && value.token === run.result?.token, 'invalid_step_result')
  requireThat(['completed', 'blocked', 'failed'].includes(String(value.status)) && text(value.summary, 160), 'invalid_step_result')
  requireThat(Array.isArray(value.checks) && value.checks.length >= 1 && value.checks.length <= 8, 'invalid_step_result')
  for (const check of value.checks) requireThat(record(check) && exact(check, ['name', 'status', 'evidence']) && text(check.name, 80) && text(check.evidence, 400) && ['passed', 'failed'].includes(String(check.status)), 'invalid_step_result')
  requireThat(Array.isArray(value.questions) && value.questions.length <= 4 && value.questions.every(q => text(q, 200)), 'invalid_step_result')
  return value as unknown as StepResult
}
export function resultInstructions(workflowId: string, stepId: string, run: StepRun): string {
  requireThat(run.result && run.plan, 'result_contract_missing')
  return `\nAutomatic workflow: do not launch agents. Complete this step only. Last filesystem action: atomically write UTF-8 JSON (<=8192 bytes) to ${JSON.stringify(run.result.path)}. Report actual checks; never claim unperformed checks passed. Schema (exact keys): ${JSON.stringify({ version: 1, workflowId, stepId, planId: run.plan.id, token: run.result.token, status: 'completed|blocked|failed', summary: '<=160 UTF-8 bytes', checks: [{ name: '<=80 bytes', status: 'passed|failed', evidence: '<=400 bytes' }], questions: [] })}. checks: 1..8; questions: 0..4 strings <=200 bytes. Use blocked for questions/permission requests; failed for failed checks. Validate exact keys and all UTF-8 byte limits before the final write. After writing, finish the turn and perform no further tools. Reports are self-reported, not independent verification.`
}
