import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile, symlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Engine } from '../src/core/engine.ts'
import { DEFAULT_CONFIG } from '../src/core/config.ts'
import { Workflows, validateAnalysis, coordinatorPrompt, type Analysis, type Artifacts } from '../src/core/workflow.ts'
import { PrivateArtifacts } from '../src/core/artifacts.ts'
import type { Runtime, Store, Transport, Workspace } from '../src/core/types.ts'
const workspace: Workspace = { id: 'synthetic', path: '/synthetic-project', host: 'local' }
const analysis = (): Analysis => ({
  version: 1, summary: 'Synthetic analysis after reading the referenced documentation.', assumptions: ['Synthetic assumption'], questions: [],
  sources: [{ reference: 'https://example.invalid/docs', status: 'read', summary: 'Synthetic protocol requirements.' }],
  steps: [
    { id: 'implement', title: 'Synthetic implementation', instructions: 'LOCAL-INSTRUCTION-MARKER: implement a synthetic feature.', acceptance: 'Synthetic checks pass.', context: 'LOCAL-CONTEXT-MARKER', routingBrief: 'Small bounded implementation with straightforward checks.', allowedAgents: ['codex', 'pi', 'cursor'], dependsOn: [] },
    { id: 'verify', title: 'Synthetic verification', instructions: 'Review the synthetic result.', acceptance: 'Acceptance criteria verified.', context: '', routingBrief: 'Independent review of a small implementation.', allowedAgents: ['codex'], dependsOn: ['implement'] }
  ]
})
function fixture(options: { execution?: boolean; live?: boolean } = {}) {
  const config = structuredClone(DEFAULT_CONFIG); config.execution = options.execution ?? false; config.live = options.live ?? false
  config.profiles.push({ ...config.profiles[0]!, id: 'cursor-test', agent: 'cursor', model: 'synthetic-high', effort: null })
  const data = new Map<string, unknown>([['config', config]])
  const store: Store = { get: async k => structuredClone(data.get(k) ?? null), set: async (k, v) => { data.set(k, structuredClone(v)) } }
  const calls: unknown[][] = [], traffic: string[] = []; let keyReads = 0, raw: string | null = null
  const runtime: Runtime = { verify: async () => ({ verified: true, source: 'synthetic' }), launch: async (...args) => { calls.push(args); return { code: 0, stdout: '{"ok":true,"result":{"outcome":{"kind":"structured","handle":"orca_session_id:synthetic"},"prompt":{"outcome":"journaled"}}}' } } }
  const transport: Transport = async (_url, options) => {
    if (!options.body) return { data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '0.000000042', completion: '0' } } }
    traffic.push(options.body)
    const ids = Object.keys(JSON.parse(options.body).questions.profile.criteria)
    const choice = ids.includes('cursor-test') ? 'cursor-test' : ids[0]
    return { answers: { profile: { type: 'choice', choice, confidence: .9, probabilities: Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0])) } }, usage: { cost: .00001 } }
  }
  const engine = new Engine(store, runtime, async () => { keyReads++; return 'synthetic-key' }, transport)
  const artifacts: Artifacts = { create: async () => '/synthetic-private/analysis.json', read: async () => raw }
  const flows = new Workflows(store, engine, artifacts)
  return { flows, engine, config, data, store, artifacts, runtime, calls, traffic, get keyReads() { return keyReads }, setRaw(value: unknown) { raw = typeof value === 'string' ? value : JSON.stringify(value) } }
}
async function prepared(f: ReturnType<typeof fixture>) {
  const flow = await f.flows.create('Synthetic task: https://example.invalid/docs', 'standard', workspace)
  f.setRaw(analysis()); await f.flows.read(flow.id, workspace); await f.flows.approve(flow.id, workspace)
  return flow.id
}
test('analysis preparation fixes the coordinator profile without JEV or accidental execution', async () => {
  const f = fixture({ live: true }); const w = await f.flows.create('Synthetic task', 'standard', workspace)
  assert.equal(w.coordinator.profile.id, 'standard'); assert.equal(w.coordinator.reason, 'coordinator_profile')
  assert.equal(f.keyReads, 0); assert.equal(f.traffic.length, 0); assert.equal(f.calls.length, 0)
  await assert.rejects(f.flows.launchCoordinator(w.id, workspace), /execution_disabled/)
  await assert.rejects(f.flows.route(w.id, 'implement', workspace), /workflow_not_ready/)
  await f.flows.cancel(w.id, workspace)
  await assert.rejects(f.flows.create('Synthetic', '', workspace), /invalid_profile/)
})
test('strict analysis rejects cycles, unknown dependencies, duplicate IDs, fields and model injection', () => {
  for (const mutate of [
    (a: any) => { a.steps[0].dependsOn = ['verify'] }, (a: any) => { a.steps[1].dependsOn = ['unknown'] },
    (a: any) => { a.steps[1].id = 'implement' }, (a: any) => { a.steps[0].model = 'evil' },
    (a: any) => { a.steps[0].allowedAgents = ['evil; command'] }, (a: any) => { a.steps[0].id = '../evil' }
  ]) { const a = analysis(); mutate(a); assert.throws(() => validateAnalysis(a)) }
})
test('unanswered questions and unavailable documentation block approval and routing', async () => {
  for (const kind of ['questions', 'sources']) {
    const f = fixture(), w = await f.flows.create('Synthetic', 'standard', workspace), a = analysis()
    if (kind === 'questions') a.questions.push('Synthetic clarification?'); else a.sources[0]!.status = 'unavailable'
    f.setRaw(a); await f.flows.read(w.id, workspace)
    await assert.rejects(f.flows.approve(w.id, workspace), /analysis_needs_clarification/)
    await assert.rejects(f.flows.route(w.id, 'implement', workspace)); assert.equal(f.traffic.length, 0)
  }
})
test('reviewed subtasks select across agents; JEV sees only the approved routing brief', async () => {
  const f = fixture({ live: true }), id = await prepared(f)
  const w = await f.flows.route(id, 'implement', workspace)
  assert.equal(w.runs.implement!.plan!.profile.agent, 'cursor')
  assert.equal(w.runs.implement!.plan!.profile.effort, null)
  assert.equal(f.calls.length, 0)
  assert.ok(f.traffic[0]!.includes(analysis().steps[0]!.routingBrief))
  assert.ok(!f.traffic[0]!.includes('LOCAL-INSTRUCTION-MARKER')); assert.ok(!f.traffic[0]!.includes('LOCAL-CONTEXT-MARKER'))
  await assert.rejects(f.flows.launch(id, 'implement', workspace), /execution_disabled/)
})
test('dependency gates require an explicitly launched and reviewed predecessor', async () => {
  const f = fixture({ execution: true, live: true }), id = await prepared(f)
  await assert.rejects(f.flows.route(id, 'verify', workspace), /dependencies_not_reviewed/)
  await assert.rejects(f.flows.review(id, 'implement', 'Synthetic review', workspace), /step_not_reviewable/)
  await f.flows.route(id, 'implement', workspace); await f.flows.launch(id, 'implement', workspace)
  await assert.rejects(f.flows.route(id, 'verify', workspace), /dependencies_not_reviewed/)
  await f.flows.review(id, 'implement', 'Synthetic acceptance checks passed.', workspace)
  const w = await f.flows.route(id, 'verify', workspace)
  assert.equal(w.runs.verify!.plan!.profile.agent, 'codex'); assert.equal(f.calls.length, 1)
  await f.flows.launch(id, 'verify', workspace)
  assert.equal(f.calls.length, 2); assert.ok(JSON.stringify(f.calls[1]).includes('Synthetic acceptance checks passed.'))
})
test('concurrent dispatch and worker recreation cannot repeat an accepted step', async () => {
  const f = fixture({ execution: true }), id = await prepared(f); await f.flows.route(id, 'implement', workspace)
  const results = await Promise.allSettled([f.flows.launch(id, 'implement', workspace), f.flows.launch(id, 'implement', workspace)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.length, 1)
  const restarted = new Workflows(f.store, f.engine, f.artifacts)
  assert.equal((await restarted.current(workspace))!.runs.implement!.state, 'submitted')
  await assert.rejects(restarted.launch(id, 'implement', workspace)); assert.equal(f.calls.length, 1)
})
test('a lost dispatch blocks retries, review and all other starts', async () => {
  const f = fixture({ execution: true }), id = await prepared(f)
  f.runtime.launch = async () => { throw new Error('synthetic lost receipt') }
  await f.flows.route(id, 'implement', workspace)
  assert.equal((await f.flows.launch(id, 'implement', workspace)).runs.implement!.state, 'dispatch_unknown')
  await assert.rejects(f.flows.launch(id, 'implement', workspace), /workflow_running/)
  await assert.rejects(f.flows.review(id, 'implement', 'Synthetic', workspace), /step_not_reviewable/)
})
test('approved analysis is immutable; cross-workspace access and cancelled plans are refused', async () => {
  const f = fixture(), id = await prepared(f), changed = analysis(); changed.steps[0]!.routingBrief = 'Changed'
  f.setRaw(changed); await assert.rejects(f.flows.read(id, workspace), /analysis_already_approved/)
  await assert.rejects(f.flows.route(id, 'implement', { ...workspace, id: 'other' }), /workflow_workspace_changed/)
  await f.flows.cancel(id, workspace); await assert.rejects(f.flows.route(id, 'implement', workspace), /workflow_not_ready/)
  assert.equal(f.calls.length, 0)
})
test('missing, duplicate-key and excessive analysis never become an approved plan', async () => {
  const f = fixture(), w = await f.flows.create('Synthetic', 'standard', workspace)
  await assert.rejects(f.flows.read(w.id, workspace), /analysis_not_found/)
  f.setRaw('{"version":1,"version":1}'); await assert.rejects(f.flows.read(w.id, workspace), /duplicate_json_key/)
  f.setRaw('x'.repeat(32769)); await assert.rejects(f.flows.read(w.id, workspace), /invalid_analysis/)
})
test('workflow audit stores identifiers and states, never task, source, context or review', async () => {
  const f = fixture({ execution: true }), id = await prepared(f)
  await f.flows.route(id, 'implement', workspace); await f.flows.launch(id, 'implement', workspace)
  await f.flows.review(id, 'implement', 'PRIVATE-REVIEW-MARKER', workspace)
  const audit = JSON.stringify(await f.engine.history())
  for (const marker of ['example.invalid', 'LOCAL-CONTEXT', 'PRIVATE-REVIEW', 'Synthetic task']) assert.ok(!audit.includes(marker))
})
test('private artifacts reject traversal, symlinks and oversized files', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-workflows-'))
  try {
    const artifacts = new PrivateArtifacts(root), id = randomUUID(), path = await artifacts.create(id)
    if (process.platform !== 'win32') assert.equal((await stat(join(root, id))).mode & 0o777, 0o700)
    assert.equal(await artifacts.read(id), null)
    await assert.rejects(artifacts.read('../outside'), /invalid_workflow/)
    await writeFile(path, 'x'.repeat(32769)); await assert.rejects(artifacts.read(id), /invalid_analysis/)
    await rm(path); const target = join(root, 'synthetic.txt'); await writeFile(target, '{}'); await symlink(target, path)
    await assert.rejects(artifacts.read(id), /artifact_path_refused/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('missing task references block approval even when other sources claim to be read', async () => {
  const f = fixture(), w = await f.flows.create('Synthetic https://example.invalid/required', 'standard', workspace)
  f.setRaw(analysis()); await f.flows.read(w.id, workspace)
  await assert.rejects(f.flows.approve(w.id, workspace), /analysis_missing_sources/)
  assert.equal(f.traffic.length, 0)
})
test('new workflows share the existing bounded JEV accounting', async () => {
  const f = fixture({ live: true }); f.config.maxCalls = 1
  const first = await prepared(f); await f.flows.route(first, 'implement', workspace); await f.flows.cancel(first, workspace)
  const second = await prepared(f), w = await f.flows.route(second, 'implement', workspace)
  assert.equal(w.runs.implement!.plan!.reason, 'budget_exhausted'); assert.equal(f.traffic.length, 1)
  assert.equal((await f.engine.ledger()).calls, 1); assert.equal(f.calls.length, 0)
})
test('a pre-dispatch configuration failure preserves the step for a fresh routing decision', async () => {
  const f = fixture({ execution: true }), id = await prepared(f); await f.flows.route(id, 'implement', workspace)
  await f.engine.saveConfig({ ...f.config, maxCalls: 4 })
  await assert.rejects(f.flows.launch(id, 'implement', workspace), /plan_changed/)
  assert.equal((await f.flows.current(workspace))!.runs.implement!.state, 'planned'); assert.equal(f.calls.length, 0)
  await f.flows.route(id, 'implement', workspace); await f.flows.launch(id, 'implement', workspace)
  assert.equal(f.calls.length, 1)
})
test('a blocked coordinator can refresh verification without changing its task or launching', async () => {
  const f = fixture(); f.runtime.verify = async () => ({ verified: false, source: 'codex_catalog_version_mismatch' })
  const original = await f.flows.create('Synthetic coordinator task', 'standard', workspace)
  f.runtime.verify = async () => ({ verified: true, source: 'synthetic-managed-catalog' })
  const refreshed = await f.flows.refreshCoordinator(original.id, workspace)
  assert.equal(refreshed.task, original.task); assert.equal(refreshed.artifact, original.artifact)
  assert.equal(refreshed.coordinator.evidence.verified, true); assert.notEqual(refreshed.coordinator.id, original.coordinator.id)
  assert.equal(f.calls.length, 0); assert.equal(f.traffic.length, 0)
  assert.equal((f.data.get('plan:' + original.coordinator.id) as any).state, 'cancelled')
})
test('an existing unknown coordinator can supply analysis without permitting another launch', async () => {
  const f = fixture({ execution: true }), w = await f.flows.create('Synthetic task', 'standard', workspace)
  w.coordinator.state = 'dispatch_unknown'; await f.store.set('workflow:' + w.id, w)
  f.setRaw(analysis()); const loaded = await f.flows.read(w.id, workspace)
  assert.ok(loaded.analysis); assert.equal(loaded.coordinator.state, 'dispatch_unknown')
  await f.flows.approve(w.id, workspace)
  await assert.rejects(f.flows.launchCoordinator(w.id, workspace), /workflow_not_ready/)
  assert.equal(f.calls.length, 0)
})
test('analysis assumptions and questions have explicit UTF-8 bounds suitable for localized text', () => {
  const a = analysis(); a.assumptions = ['я'.repeat(101)]; a.questions = ['я'.repeat(200)]
  assert.equal(validateAnalysis(a).assumptions[0], a.assumptions[0])
  a.questions = ['я'.repeat(201)]; assert.throws(() => validateAnalysis(a), /invalid_analysis/)
  a.questions = []; a.assumptions = Array(9).fill('Synthetic'); assert.throws(() => validateAnalysis(a), /invalid_analysis/)
})
test('analysis inspection reports exact bounded fields without private text or state changes', async () => {
  const f = fixture(), w = await f.flows.create('Synthetic task', 'standard', workspace), a = analysis()
  a.sources = Array.from({ length: 14 }, (_, i) => ({ reference: `synthetic:${i}`, status: 'read', summary: 'Synthetic source' }))
  f.setRaw(a); assert.deepEqual(await f.flows.inspect(w.id, workspace), { valid: true })
  assert.equal((await f.flows.read(w.id, workspace)).analysis?.sources.length, 14)
  a.sources = Array.from({ length: 33 }, (_, i) => ({ reference: `synthetic:${i}`, status: 'read', summary: 'PRIVATE-MARKER' }))
  f.setRaw(a)
  const before = structuredClone([...f.data])
  assert.deepEqual(await f.flows.inspect(w.id, workspace), { valid: false, issue: { path: 'sources', rule: 'items', actual: 33, limit: 32 } })
  assert.deepEqual([...f.data], before); assert.equal(f.calls.length, 0); assert.equal(f.traffic.length, 0)
  a.sources = []; a.steps[0]!.routingBrief = 'я'.repeat(401); f.setRaw(a)
  assert.deepEqual(await f.flows.inspect(w.id, workspace), { valid: false, issue: { path: 'steps[0].routingBrief', rule: 'bytes', actual: 802, limit: 800 } })
  await assert.rejects(f.flows.inspect(w.id, { ...workspace, id: 'other' }), /workflow_workspace_changed/)
})
test('coordinator instructions disclose all collection and byte limits', () => {
  const f = fixture()
  return f.flows.create('Synthetic task', 'standard', workspace).then(w => {
    assert.ok(w.coordinatorTask.includes('at most 32 entries'))
    assert.ok(w.coordinatorTask.includes('at most 8 strings'))
    assert.ok(w.coordinatorTask.includes('at most 7 unique step ids'))
    assert.ok(w.coordinatorTask.includes('UTF-8 bytes, not characters'))
  })
})
test('long coordinator tasks stay local and survive preparation, refresh and launch beyond the routed-task limit', async () => {
  const f = fixture({ execution: true, live: true }), task = 'я'.repeat(4096)
  const w = await f.flows.create(task, 'standard', workspace)
  assert.ok(Buffer.byteLength(w.coordinatorTask) > 8192)
  assert.equal(w.coordinator.purpose, 'coordinator'); assert.equal(f.traffic.length, 0); assert.equal(f.keyReads, 0); assert.equal(f.calls.length, 0)
  const refreshed = await f.flows.refreshCoordinator(w.id, workspace)
  assert.equal(refreshed.task, task); assert.equal(refreshed.coordinator.purpose, 'coordinator')
  const sent = await f.flows.launchCoordinator(w.id, workspace)
  assert.equal(sent.coordinator.state, 'submitted'); assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0]![1], refreshed.coordinatorTask)
  assert.ok(Buffer.byteLength(coordinatorPrompt('\u0001'.repeat(8192), '/synthetic-private/analysis.json')) <= 65536)
  assert.equal(f.traffic.length, 0); assert.equal(f.keyReads, 0)
  await assert.rejects(f.flows.create(task + 'a', 'standard', workspace), /workflow_task_too_large/)
})
