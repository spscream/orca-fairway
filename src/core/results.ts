import { record, requireThat } from './config.ts'
import type { StepRun } from './workflow.ts'
export interface StepResult {
  version: 1 | 2 | 3; workflowId: string; stepId: string; planId: string; token: string
  status: 'completed' | 'blocked' | 'failed'; summary: string
  checks: { name: string; status: 'passed' | 'failed'; evidence: string }[]; questions: string[]
  repair?: string | null
  findings?: { severity: 'P0' | 'P1' | 'P2' | 'P3'; summary: string; evidence: string }[]
}
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',')
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= max
export function validateStepResult(value: unknown, workflowId: string, stepId: string, run: StepRun): StepResult {
  requireThat(record(value) && exact(value, ['version', 'workflowId', 'stepId', 'planId', 'token', 'status', 'summary', 'checks', 'questions', ...(value.version === 2 || value.version === 3 ? ['findings'] : []), ...(value.version === 3 ? ['repair'] : [])]), 'invalid_step_result')
  requireThat(run.plan && run.result, 'invalid_step_result')
  requireThat((value.version === 1 || value.version === 2 || value.version === 3) && value.workflowId === workflowId && value.stepId === stepId && value.planId === run.plan?.id && value.token === run.result?.token, 'invalid_step_result')
  requireThat(typeof value.status === 'string' && ['completed', 'blocked', 'failed'].includes(value.status) && text(value.summary, 160), 'invalid_step_result')
  requireThat(Array.isArray(value.checks) && value.checks.length >= 1 && value.checks.length <= 8, 'invalid_step_result')
  for (const check of value.checks) requireThat(record(check) && exact(check, ['name', 'status', 'evidence']) && text(check.name, 80) && text(check.evidence, 400) && typeof check.status === 'string' && ['passed', 'failed'].includes(check.status), 'invalid_step_result')
  requireThat(Array.isArray(value.questions) && value.questions.length <= 4 && value.questions.every(q => text(q, 200)), 'invalid_step_result')
  if (value.version === 2 || value.version === 3) {
    requireThat(Array.isArray(value.findings) && value.findings.length <= 8, 'invalid_step_result')
    for (const finding of value.findings) requireThat(record(finding) && exact(finding, ['severity', 'summary', 'evidence']) && typeof finding.severity === 'string' && ['P0', 'P1', 'P2', 'P3'].includes(finding.severity) && text(finding.summary, 160) && text(finding.evidence, 400), 'invalid_step_result')
  }
  if (value.version === 3) requireThat(value.repair === null ||
    (value.status !== 'blocked' && value.questions.length === 0 && text(value.repair, 400) &&
      (value.checks.some(check => record(check) && check.status === 'failed') || (value.findings as unknown[]).length > 0)), 'invalid_step_result')
  return value as unknown as StepResult
}
export function resultInstructions(workflowId: string, stepId: string, run: StepRun, adaptive = false): string {
  requireThat(run.result && run.plan, 'result_contract_missing')
  return `\nAutomatic workflow: no agents. Complete this step only. Last filesystem action: atomically write UTF-8 JSON (<=8192 bytes) to ${JSON.stringify(run.result.path)}. Schema (exact keys): ${JSON.stringify({ version: adaptive ? 3 : 2, workflowId, stepId, planId: run.plan.id, token: run.result.token, status: 'completed|blocked|failed', summary: '<=160 UTF-8 bytes', checks: [{ name: '<=80 bytes', status: 'passed|failed', evidence: '<=400 bytes' }], findings: [{ severity: 'P0|P1|P2|P3', summary: '<=160 bytes', evidence: '<=400 bytes' }], questions: [], ...(adaptive ? { repair: 'null or <=400 UTF-8 bytes' } : {}) })}. checks: 1..8; findings: 0..8; questions: 0..4 strings <=200 bytes. status/checks describe completion against THIS STEP's acceptance, not product health. A completed audit can have findings and passed audit checks. Put observed product defects in findings, with evidence; never hide failed implementation/acceptance checks there. Unperformed checks cannot pass. Use blocked for unresolved questions or permissions, failed for unmet step acceptance. Findings alone do not fail an audit or prove readiness; propagate them to dependent steps. Validate exact keys and UTF-8 limits. After writing, finish the turn, no further tools. Evidence is self-reported.${adaptive ? ' Set repair to null unless an observed defect requires a concrete correction explicitly within the original task. Set repair to a concise evidence-based correction note. Do not request new permissions, changes outside scope, or repairs for unavailable checks. Block on unresolved scope or user decisions.' : ''}`
}
