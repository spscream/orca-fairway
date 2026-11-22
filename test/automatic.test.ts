import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from '../src/core/engine.ts'
import { Automatic } from '../src/core/automatic.ts'
import { DEFAULT_CONFIG, RouterError } from '../src/core/config.ts'
import { Workflows, type Analysis, type Artifacts, type Workflow } from '../src/core/workflow.ts'
import { validateStepResult } from '../src/core/results.ts'
import type { Store, Runtime, Transport } from '../src/core/types.ts'
const workspace = { id: 'synthetic', path: '/synthetic-project', host: 'local' as const }
function fixture(options: { key?: string | null; maxCalls?: number; invalidChoice?: boolean; execution?: boolean; confidence?: number; choice?: string; transportError?: string; resultPrefix?: string } = {}) {
  const config = structuredClone(DEFAULT_CONFIG); config.live = true; config.execution = options.execution ?? true; config.maxCalls = options.maxCalls ?? 5
  const memory = new Map<string, unknown>([['config', config]]), reports = new Map<string, string>()
  const store: Store = { get: async k => structuredClone(memory.get(k) ?? null), set: async (k, v) => { memory.set(k, structuredClone(v)) } }
  let observed: 'working' | 'done' | 'blocked' | 'unknown' = 'working', decisions = 0, launches = 0, now = Date.now()
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), observe: async () => observed,
    launch: async () => { launches++; return { code: 0, stdout: JSON.stringify({ ok: true, result: { outcome: { kind: 'structured', handle: `orca_session_id:synthetic-${launches}` }, prompt: { outcome: 'journaled' } } }) } } }
  const transport: Transport = async (_url, args) => {
    if (!args.body) return { data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '0.000000042', completion: '0' } } }
    decisions++; if (options.transportError) throw new RouterError(options.transportError)
    const ids = Object.keys(JSON.parse(args.body).questions.profile.criteria), choice = options.invalidChoice ? '; synthetic injection' : options.choice ?? ids[decisions % ids.length]!
    return { answers: { profile: { type: 'choice', choice, confidence: options.confidence ?? 1, probabilities: Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0])) } }, usage: { cost: 0.000001 } }
  }
  let analysis: Analysis = { version: 1, summary: 'Synthetic analysis', assumptions: [], questions: [], sources: [], steps: ['first', 'second'].map((id, i) => ({ id, title: 'Synthetic step', instructions: 'Perform a synthetic check.', acceptance: 'Synthetic check passes.', context: '', routingBrief: 'Synthetic bounded work.', allowedAgents: ['codex'], dependsOn: i ? ['first'] : [] })) }
  const artifacts: Artifacts = { create: async () => '/synthetic-private/analysis.json', read: async () => JSON.stringify(analysis), createResult: async (_id, step, token) => `${options.resultPrefix ?? '/synthetic-private'}/result-${step}-${token}.json`, readResult: async (_id, _step, token) => reports.get(token) ?? null }
  const engine = new Engine(store, runtime, async () => options.key === undefined ? 'synthetic-key' : options.key, transport), flows = new Workflows(store, engine, artifacts)
  const automatic = new Automatic(store, flows, engine, runtime, () => now)
  const create = async () => { const w = await flows.create('Synthetic task', config.fallback, workspace); await flows.read(w.id, workspace); return w.id }
  const report = async (id: string, step = 'first', overrides: Record<string, unknown> = {}) => {
    const w = await flows.get(id, workspace), run = w.runs[step]!
    const value = { version: 1, workflowId: id, stepId: step, planId: run.plan!.id, token: run.result!.token, status: 'completed', summary: 'Synthetic check passed.', checks: [{ name: 'Synthetic check', status: 'passed', evidence: 'Synthetic evidence.' }], questions: [], ...overrides }
    reports.set(run.result!.token, JSON.stringify(value)); return value
  }
  return { config, memory, store, engine, flows, runtime, automatic, create, report, reports, get launches() { return launches }, get decisions() { return decisions }, set observed(value: typeof observed) { observed = value }, advance(ms: number) { now += ms }, setAnalysis(value: Analysis) { analysis = value } }
}
test('automatic plan needs one explicit authorization, selects each profile and accepts only ended turns with passed reports', async () => {
  const f = fixture(), id = await f.create()
  assert.equal(await f.automatic.tick(), null); assert.equal(f.launches, 0); assert.equal(f.decisions, 0)
  await f.automatic.start(id, workspace)
  await Promise.all([f.automatic.tick(), f.automatic.tick(), f.automatic.tick()])
  assert.equal(f.launches, 1); assert.equal(f.decisions, 1)
  let w = await f.flows.get(id, workspace); const first = w.runs.first!.plan!.profile.id
  await f.report(id); await f.automatic.tick(); assert.equal((await f.flows.get(id, workspace)).runs.first!.state, 'submitted')
  f.observed = 'done'; await f.automatic.tick(); assert.equal((await f.flows.get(id, workspace)).runs.first!.state, 'completed')
  await f.automatic.tick(); assert.equal(f.launches, 2); assert.equal(f.decisions, 2)
  w = await f.flows.get(id, workspace); assert.notEqual(w.runs.second!.plan!.profile.id, first)
  await f.report(id, 'second'); await f.automatic.tick(); w = (await f.automatic.tick())!
  assert.equal(w.automatic?.state, 'completed'); await f.automatic.tick(); assert.equal(f.launches, 2)
  assert.equal(f.config.maxCalls, 5)
})
test('budget exhaustion, missing key and invalid choice never fall through to an automatic launch', async () => {
  for (const options of [{ maxCalls: 0 }, { key: null }, { invalidChoice: true }]) {
    const f = fixture(options), id = await f.create()
    if (options.maxCalls === 0) { await assert.rejects(f.automatic.start(id, workspace), /automatic_budget_exhausted/); assert.equal(f.launches, 0); continue }
    await f.automatic.start(id, workspace)
    const w = (await f.automatic.tick())!
    assert.equal(w.automatic?.state, 'paused'); assert.equal(f.launches, 0)
    await f.automatic.tick(); assert.equal(f.launches, 0)
  }
})
test('low confidence uses the verified configured fallback once without paid retries or implicit authorization', async () => {
  for (const confidence of [0, .59]) {
    const f = fixture({ confidence }), id = await f.create()
    await f.automatic.tick(); assert.equal(f.launches, 0); assert.equal(f.decisions, 0)
    await f.automatic.start(id, workspace); await f.automatic.tick(); await f.automatic.tick()
    const w = await f.flows.get(id, workspace), plan = w.runs.first!.plan!
    assert.equal(w.automatic?.state, 'running'); assert.equal(w.runs.first!.state, 'submitted')
    assert.equal(plan.profile.id, f.config.fallback); assert.equal(plan.reason, 'low_confidence_fallback'); assert.equal(plan.confidence, confidence)
    assert.equal(f.launches, 1); assert.equal(f.decisions, 1); assert.equal((await f.engine.ledger()).calls, 1)
  }
})
test('low confidence never launches an unverified fallback or substitutes a different eligible profile', async () => {
  for (const excluded of [false, true]) {
    const f = fixture({ confidence: .4 }), id = await f.create()
    if (excluded) Object.assign(f.config.profiles.find(p => p.id === f.config.fallback)!, { agent: 'cursor', effort: null })
    else f.runtime.verify = async () => ({ verified: false, source: 'synthetic_unavailable' })
    await f.automatic.start(id, workspace); const w = (await f.automatic.tick())!
    assert.equal(w.automatic?.state, 'paused'); assert.equal(w.automatic?.reason, excluded ? 'low_confidence' : 'unverified')
    assert.equal(f.launches, 0); assert.equal(f.decisions, 1)
  }
})
test('transport failures still pause automatic execution rather than launching the fallback', async () => {
  for (const transportError of ['timeout', 'http_error', 'invalid_response', 'invalid_probabilities']) {
    const f = fixture({ transportError }), id = await f.create(); await f.automatic.start(id, workspace)
    const w = (await f.automatic.tick())!
    assert.equal(w.automatic?.state, 'paused'); assert.equal(f.launches, 0); assert.equal(f.decisions, 1)
  }
})
test('failed, blocked, mismatched and malformed reports stop the graph without another executor', async () => {
  for (const fields of [{ token: 'synthetic-wrong' }, { status: 'failed' }, { questions: ['Synthetic question'] }, { checks: [{ name: 'Synthetic', status: 'failed', evidence: 'Synthetic failure.' }] }]) {
    const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick(); await f.report(id, 'first', fields)
    f.observed = 'done'; const w = (await f.automatic.tick())!
    assert.equal(w.automatic?.state, 'paused'); assert.equal(w.runs.first!.state, 'submitted'); assert.equal(f.launches, 1)
  }
})
test('config changes, pause and worker recovery require explicit continuation and never spawn on activation', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace)
  await f.automatic.recover(); await f.automatic.tick(); assert.equal(f.launches, 0)
  await f.automatic.start(id, workspace); await f.automatic.pause(); await f.automatic.tick(); assert.equal(f.launches, 0)
  await f.automatic.start(id, workspace); f.memory.set('config', { ...f.config, execution: false })
  assert.equal((await f.automatic.tick())?.automatic?.reason, 'execution_disabled'); assert.equal(f.launches, 0)
})
test('pause during metadata verification prevents dispatch', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace)
  let release: (() => void) | undefined
  f.runtime.verify = async () => { await new Promise<void>(r => { release = r }); return { verified: true, source: 'synthetic' } }
  const ticking = f.automatic.tick()
  while (!release) await new Promise(r => setImmediate(r))
  const pausing = f.automatic.pause(); release(); await ticking; await pausing
  assert.equal(f.launches, 0); assert.equal((await f.flows.get(id, workspace)).automatic?.state, 'paused')
})
test('limits, missing reports and unknown monitoring never infer a successful result', async () => {
  for (const mode of ['missing', 'unknown', 'deadline', 'total']) {
    const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
    f.observed = mode === 'unknown' ? 'unknown' : 'done'
    f.advance(mode === 'total' ? 2 * 60 * 60_000 : mode === 'deadline' ? 31 * 60_000 : mode === 'unknown' ? 121000 : 21000)
    const w = (await f.automatic.tick())!; assert.equal(w.automatic?.state, 'paused'); assert.equal(f.launches, 1)
  }
})
test('legacy submitted step receives one manual review before subsequent work is automated', async () => {
  const f = fixture(), id = await f.create(); await f.flows.approve(id, workspace); await f.flows.route(id, 'first', workspace); await f.flows.launch(id, 'first', workspace)
  await f.automatic.start(id, workspace); assert.equal((await f.automatic.tick())?.automatic?.reason, 'legacy_review')
  assert.equal(f.launches, 1); await f.flows.review(id, 'first', 'Synthetic manual review.', workspace)
  await f.automatic.tick(); assert.equal(f.launches, 2)
})
test('step reports require bounded exact identifiers, checks and text', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
  const value = await f.report(id), run = (await f.flows.get(id, workspace)).runs.first!
  assert.equal(validateStepResult(value, id, 'first', run).status, 'completed')
  for (const overrides of [{ extra: true }, { planId: 'wrong' }, { checks: [] }, { summary: 'я'.repeat(81) }, { questions: Array(5).fill('Synthetic') }]) assert.throws(() => validateStepResult({ ...value, ...overrides }, id, 'first', run), /invalid_step_result/)
})
test('shadow mode and unknown dispatches cannot authorize or restart automatic execution', async () => {
  const shadow = fixture({ execution: false }), shadowId = await shadow.create()
  await assert.rejects(shadow.automatic.start(shadowId, workspace), /execution_disabled/); assert.equal(shadow.launches, 0)
  const f = fixture(), id = await f.create(); await f.flows.approve(id, workspace)
  const w = await f.flows.get(id, workspace); w.runs.first!.state = 'dispatch_unknown'; await f.store.set('workflow:' + id, w)
  await assert.rejects(f.automatic.start(id, workspace), /workflow_running/); assert.equal(f.launches, 0)
})
test('authorization expiry during routing and corrupt launch limits fail before executor dispatch', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace)
  f.runtime.verify = async () => { f.advance(2 * 60 * 60_000); return { verified: true, source: 'synthetic' } }
  assert.equal((await f.automatic.tick())?.automatic?.reason, 'expired'); assert.equal(f.launches, 0)
  const other = fixture(), otherId = await other.create(); await other.automatic.start(otherId, workspace)
  const w = await other.flows.get(otherId, workspace); w.automatic!.limit = 100; await other.store.set('workflow:' + otherId, w)
  await assert.rejects(other.automatic.tick(), /invalid_automatic_state/); assert.equal(other.launches, 0)
})
test('a provisional report is not parsed while its executor is still working', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
  const w = await f.flows.get(id, workspace); f.reports.set(w.runs.first!.result!.token, '{unfinished')
  assert.equal((await f.automatic.tick())?.automatic?.state, 'running')
  f.observed = 'done'; assert.equal((await f.automatic.tick())?.automatic?.reason, 'result_invalid')
  assert.equal(f.launches, 1)
})
test('automatic authorization preflights the whole remaining graph without charging or approving it', async () => {
  const f = fixture({ maxCalls: 1 }), id = await f.create()
  await assert.rejects(f.automatic.start(id, workspace), /automatic_budget_exhausted/)
  const w = await f.flows.get(id, workspace)
  assert.equal(w.approvedHash, null); assert.equal(w.automatic, undefined); assert.equal(f.decisions, 0); assert.equal(f.launches, 0)
})
test('an in-flight manual step can be reviewed with no allowance; further selection pauses before another request', async () => {
  const f = fixture(), id = await f.create(); await f.flows.approve(id, workspace)
  await f.flows.route(id, 'first', workspace); await f.flows.launch(id, 'first', workspace)
  f.memory.set('config', { ...f.config, maxCalls: 1 })
  await f.automatic.start(id, workspace); assert.equal((await f.automatic.tick())?.automatic?.reason, 'legacy_review')
  await f.flows.review(id, 'first', 'Synthetic reviewed result.', workspace)
  assert.equal((await f.automatic.tick())?.automatic?.reason, 'budget_exhausted')
  assert.equal(f.decisions, 1); assert.equal(f.launches, 1)
})
test('explicit unlimited mode allows continuation after prior caps without resetting usage', async () => {
  const f = fixture({ maxCalls: 0 }), id = await f.create()
  f.config.unlimitedJev = true; f.config.budgetMicrousd = 0; f.memory.set('config', f.config)
  f.memory.set('ledger', { calls: 5, reservedMicrousd: 65540 })
  await f.automatic.start(id, workspace); await f.automatic.tick()
  assert.equal(f.launches, 1); assert.equal(f.decisions, 1)
  assert.deepEqual(await f.engine.ledger(), { calls: 6, reservedMicrousd: 78648 })
})

test('low-confidence leaders at or above the fallback level run once; lower or unknown levels use the exact reserve', async () => {
  for (const [choice, unranked, expected, reason] of [
    ['deep', false, 'deep', 'low_confidence_ranked'],
    ['standard', false, 'standard', 'low_confidence_ranked'],
    ['routine', false, 'standard', 'low_confidence_fallback'],
    ['deep', true, 'standard', 'low_confidence_fallback']
  ] as const) {
    const f = fixture({ confidence: .4, choice })
    if (unranked) f.config.profiles.find(p => p.id === choice)!.level = null
    const id = await f.create(); await f.automatic.tick(); assert.equal(f.launches, 0)
    await f.automatic.start(id, workspace); await f.automatic.tick(); await f.automatic.tick()
    const w = await f.flows.get(id, workspace)
    assert.equal(w.runs.first!.plan!.profile.id, expected); assert.equal(w.runs.first!.plan!.reason, reason)
    assert.equal(w.automatic?.state, 'running'); assert.equal(f.launches, 1); assert.equal(f.decisions, 1)
  }
})
test('a ranked leader still needs verified metadata and cannot bypass cancellation', async () => {
  const f = fixture({ confidence: .2, choice: 'deep' }), id = await f.create()
  f.runtime.verify = async () => ({ verified: false, source: 'synthetic_unavailable' })
  await f.automatic.start(id, workspace); await f.automatic.tick()
  assert.equal((await f.flows.get(id, workspace)).automatic?.reason, 'unverified'); assert.equal(f.launches, 0)
  await f.automatic.pause(); await f.automatic.tick(); assert.equal(f.launches, 0)
})

test('completed audit findings are preserved and propagated without failing or automatically resolving defects', async () => {
  const f = fixture(), id = await f.create(), prompts: string[] = []
  const launch = f.runtime.launch
  f.runtime.launch = async (...args) => { prompts.push(args[1]); return launch(...args) }
  await f.automatic.start(id, workspace); await f.automatic.tick()
  const finding = { severity: 'P1', summary: 'Synthetic product defect', evidence: 'Synthetic reproduction.' }
  await f.report(id, 'first', { version: 2, findings: [finding] })
  await f.automatic.tick(); assert.equal((await f.flows.get(id, workspace)).runs.first!.state, 'submitted')
  f.observed = 'done'; await f.automatic.tick()
  let w = await f.flows.get(id, workspace)
  assert.equal(w.runs.first!.state, 'completed'); assert.deepEqual(w.runs.first!.outcome!.findings, [finding])
  assert.equal(w.runs.first!.outcome!.status, 'completed'); assert.equal(f.launches, 1)
  await f.automatic.tick(); w = await f.flows.get(id, workspace)
  assert.equal(f.launches, 2); assert.ok(prompts[1]!.includes(w.runs.first!.result!.path))
  assert.ok(prompts[1]!.includes('unresolved findings')); assert.ok(prompts[0]!.includes('"version":2'))
  const history = JSON.stringify(await f.engine.history())
  assert.equal(history.includes(finding.summary), false); assert.equal(history.includes(finding.evidence), false)
})
test('version two findings never bypass failed completion, failed acceptance checks or unresolved questions', async () => {
  for (const overrides of [{ status: 'failed' }, { checks: [{ name: 'Acceptance', status: 'failed', evidence: 'Synthetic missing delivery.' }] }, { questions: ['Synthetic unresolved question'] }]) {
    const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
    await f.report(id, 'first', { version: 2, findings: [{ severity: 'P3', summary: 'Synthetic defect', evidence: 'Synthetic evidence' }], ...overrides })
    f.observed = 'done'; await f.automatic.tick()
    const w = await f.flows.get(id, workspace); assert.equal(w.automatic!.state, 'paused'); assert.equal(w.runs.first!.state, 'submitted'); assert.equal(f.launches, 1)
    assert.equal(w.runs.first!.outcome!.findings!.length, 1)
  }
})
test('legacy failed audit reports remain failed; explicit operator review preserves the original report and dispatch count', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
  const old = await f.report(id, 'first', { status: 'failed', checks: [{ name: 'Product health', status: 'failed', evidence: 'Synthetic audit finding' }] })
  f.observed = 'done'; await f.automatic.tick()
  assert.equal((await f.flows.get(id, workspace)).automatic!.reason, 'checks_failed')
  await f.flows.review(id, 'first', 'Completed audit; unresolved product findings remain in its report.', workspace)
  const w = await f.flows.get(id, workspace)
  assert.equal(w.runs.first!.state, 'completed'); assert.equal(w.runs.first!.outcome!.status, 'failed')
  assert.equal(w.automatic!.state, 'paused'); assert.equal(w.automatic!.reason, 'paused')
  assert.equal(JSON.stringify(await f.flows.result(id, 'first', workspace)), JSON.stringify(old)); assert.equal(f.launches, 1); assert.equal(f.decisions, 1)
})
test('version two report findings are strictly bounded and bound to the original report identity', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
  const value = await f.report(id, 'first', { version: 2, findings: [] }), run = (await f.flows.get(id, workspace)).runs.first!
  const finding = { severity: 'P0', summary: 'Synthetic finding', evidence: 'Synthetic evidence' }
  for (const overrides of [{ findings: undefined }, { findings: Array(9).fill(finding) }, { findings: [{ ...finding, severity: ['P0'] }] }, { findings: [{ ...finding, summary: 'я'.repeat(81) }] }, { findings: [{ ...finding, evidence: 'x'.repeat(401) }] }, { findings: [{ ...finding, command: 'synthetic' }] }, { token: 'wrong' }, { status: ['completed'] }, { version: 3 }]) assert.throws(() => validateStepResult({ ...value, ...overrides }, id, 'first', run), /invalid_step_result/)
})

test('a long dependent validation task with a report contract can route and launch without the short-description limit', async () => {
  const f = fixture({ resultPrefix: '/synthetic-private/' + 'x'.repeat(120) }), prompts: string[] = []
  const launch = f.runtime.launch; f.runtime.launch = async (...args) => { prompts.push(args[1]); return launch(...args) }
  f.setAnalysis({ version: 1, summary: 'Synthetic plan', assumptions: [], questions: [], sources: [], steps: [
    { id: 'first', title: 'Synthetic audit', instructions: 'Synthetic review', context: '', acceptance: 'Synthetic evidence', routingBrief: 'Synthetic bounded audit.', allowedAgents: ['codex'], dependsOn: [] },
    { id: 'second', title: 'я'.repeat(45), instructions: 'я'.repeat(598) + 'x', context: 'я'.repeat(203) + 'x', acceptance: 'я'.repeat(128), routingBrief: 'Synthetic bounded verification.', allowedAgents: ['codex'], dependsOn: ['first'] }
  ] })
  const id = await f.create(); await f.automatic.start(id, workspace); await f.automatic.tick()
  await f.report(id); f.observed = 'done'; await f.automatic.tick(); await f.automatic.tick()
  const w = await f.flows.get(id, workspace)
  assert.equal(w.automatic!.state, 'running'); assert.equal(w.runs.second!.state, 'submitted'); assert.equal(w.runs.second!.plan!.purpose, 'workflow')
  assert.ok(Buffer.byteLength(prompts[1]!) > 4096); assert.equal(f.launches, 2); assert.equal(f.decisions, 2)
})

test('an oversized prepared prompt pauses with a precise reason before a routing request or launch', async () => {
  const f = fixture(), id = await f.create(); await f.automatic.start(id, workspace)
  f.flows.route = async () => { throw new RouterError('workflow_prompt_too_large') }
  const w = (await f.automatic.tick())!
  assert.equal(w.automatic!.state, 'paused'); assert.equal(w.automatic!.reason, 'prompt_too_large')
  assert.equal(f.launches, 0); assert.equal(f.decisions, 0)
})
