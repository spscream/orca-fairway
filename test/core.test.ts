import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Engine } from '../src/core/engine.ts'
import { DEFAULT_CONFIG, RouterError, validateConfig } from '../src/core/config.ts'
import { parseJson } from '../src/core/json.ts'
import { DECISIONS_URL, makeRequest, RESERVATION_MICROUSD, validateAnswer, validatePrice } from '../src/core/jev.ts'
import { childEnvironment, codexMetadataHome, launchArgs, NativeRuntime, orcaExecutable, runFile } from '../src/core/runtime.ts'
import type { Config, Runtime, Store, Transport, Workspace } from '../src/core/types.ts'
const workspace: Workspace = { id: 'synthetic', path: '/synthetic-project', host: 'local' }
const metadata = { data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '0.000000042', completion: '0' } } }
const response = (choice = 'deep', confidence = .9): unknown => ({ answers: { profile: { type: 'choice', choice, confidence, probabilities: { routine: .05, standard: .05, deep: .9 } } }, usage: { cost: .00001 } })
function fixture(options: { live?: boolean; execution?: boolean; key?: string | null; transport?: Transport; verified?: boolean; timeout?: number } = {}) {
  const data = new Map<string, unknown>(); const config = structuredClone(DEFAULT_CONFIG)
  config.live = options.live ?? false; config.execution = options.execution ?? false; data.set('config', config)
  const calls: unknown[][] = [], traffic: { url: string; body?: string; key?: string }[] = []
  let keyReads = 0
  const store: Store = { get: async k => structuredClone(data.get(k) ?? null), set: async (k, v) => { data.set(k, structuredClone(v)) } }
  const runtime: Runtime = { verify: async () => ({ verified: options.verified ?? true, source: 'synthetic_metadata' }), launch: async (...args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ ok: true, result: { outcome: { kind: 'structured', handle: 'orca_session_id:synthetic' }, prompt: { outcome: 'journaled' } } }) } } }
  const transport: Transport = options.transport ?? (async (url, opt) => { traffic.push({ url, body: opt.body, key: opt.key }); return opt.body ? response() : metadata })
  const engine = new Engine(store, runtime, async () => { keyReads++; return options.key === undefined ? 'synthetic-secret-12345678' : options.key }, transport, options.timeout ?? 2000)
  return { engine, data, config, runtime, store, calls, traffic, get keyReads() { return keyReads } }
}
test('default is offline shadow, with no key read, network or execution', async () => {
  const f = fixture(); const p = await f.engine.plan('Synthetic small task', 'codex', workspace)
  assert.equal(p.state, 'shadow'); assert.equal(p.reason, 'offline'); assert.equal(f.keyReads, 0); assert.equal(f.traffic.length, 0); assert.equal(f.calls.length, 0)
  await assert.rejects(f.engine.launch(p.id, 'Synthetic small task', workspace), /execution_disabled/)
})
test('live mode only decides and uses the fixed Decisions API', async () => {
  const f = fixture({ live: true }); const p = await f.engine.plan('Synthetic architecture task', 'codex', workspace)
  assert.equal(p.profile.id, 'deep'); assert.equal(p.reason, 'selected'); assert.equal(f.calls.length, 0)
  assert.equal(f.traffic[1]?.url, DECISIONS_URL)
  const body = JSON.parse(f.traffic[1]!.body!); assert.equal(body.model, 'typesafe/jev-1.14'); assert.equal(body.provider.max_price.prompt, .05)
  assert.equal(p.reservedMicrousd, RESERVATION_MICROUSD)
})
test('missing key falls back without reserving or calling the service', async () => {
  const f = fixture({ live: true, key: null }); const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  assert.equal(p.reason, 'missing_key'); assert.equal(f.traffic.length, 0); assert.equal((await f.engine.ledger()).calls, 0)
})
test('invalid and injected choices never become models or arguments', async () => {
  for (const injected of ['unknown', '--model evil', '$(touch /tmp/no)', 'deep; rm -rf x']) {
    const f = fixture({ live: true, transport: async (_u, o) => o.body ? response(injected) : metadata })
    const p = await f.engine.plan('Synthetic task', 'codex', workspace)
    assert.equal(p.profile.id, 'standard'); assert.equal(p.reason, 'invalid_choice'); assert.equal(f.calls.length, 0)
  }
})
test('low confidence with unranked profiles uses the declared fallback', async () => {
  const f = fixture({ live: true, transport: async (_u, o) => o.body ? response('deep', .4) : metadata })
  f.config.profiles.forEach(p => { delete p.level })
  const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  assert.equal(p.profile.id, 'standard'); assert.equal(p.reason, 'low_confidence_fallback')
})
test('hung transport times out and permanently retains its reservation', async () => {
  const f = fixture({ live: true, timeout: 15, transport: async () => new Promise(() => {}) })
  // Keep the synthetic process alive while AbortSignal.timeout uses an unref timer.
  const hold = setInterval(() => {}, 1000)
  try { const p = await f.engine.plan('Synthetic task', 'codex', workspace); assert.equal(p.reason, 'timeout'); assert.equal((await f.engine.ledger()).reservedMicrousd, RESERVATION_MICROUSD) }
  finally { clearInterval(hold) }
})
test('concurrent decisions cannot exceed a one-call budget', async () => {
  const f = fixture({ live: true }); f.config.maxCalls = 1; f.data.set('config', f.config)
  const plans = await Promise.all([f.engine.plan('Synthetic A', 'codex', workspace), f.engine.plan('Synthetic B', 'codex', workspace)])
  assert.equal((await f.engine.ledger()).calls, 1); assert.equal(plans.filter(p => p.reason === 'budget_exhausted').length, 1)
  assert.equal(f.traffic.filter(x => x.body).length, 1)
})
test('duplicate in-flight IDs cannot consume the budget twice', async () => {
  const f = fixture({ live: true }); const id = randomUUID()
  const results = await Promise.allSettled([f.engine.plan('Synthetic A', 'codex', workspace, id), f.engine.plan('Synthetic A', 'codex', workspace, id)])
  assert.equal(results.filter(x => x.status === 'rejected').length, 1); assert.equal((await f.engine.ledger()).calls, 1)
})
test('zero budget fails before network and corrupt ledger never resets itself', async () => {
  const f = fixture({ live: true }); f.config.budgetMicrousd = 0; f.data.set('config', f.config)
  assert.equal((await f.engine.plan('Synthetic task', 'codex', workspace)).reason, 'budget_exhausted'); assert.equal(f.traffic.length, 0)
  f.config.budgetMicrousd = 100000; f.data.set('config', f.config); f.data.set('ledger', { calls: -1, reservedMicrousd: 0 })
  assert.equal((await f.engine.plan('Synthetic task', 'codex', workspace)).reason, 'invalid_ledger'); assert.equal(f.traffic.length, 0)
})
test('budget persists across worker recreation and configuration saves', async () => {
  const f = fixture({ live: true }); await f.engine.plan('Synthetic A', 'codex', workspace)
  const engine = new Engine(f.store, f.runtime, async () => null)
  await engine.saveConfig(f.config); assert.equal((await engine.ledger()).calls, 1)
})
test('configuration changes and cancellation invalidate a delayed result', async () => {
  let resolve: ((value: unknown) => void) | undefined
  const f = fixture({ live: true, execution: true, transport: async () => new Promise(r => { resolve = r }) })
  const id = randomUUID(), pending = f.engine.plan('Synthetic task', 'codex', workspace, id)
  while (!resolve) await new Promise(r => setImmediate(r))
  await f.engine.saveConfig({ ...f.config, live: false }); resolve(metadata)
  const p = await pending; assert.equal(p.state, 'cancelled'); await assert.rejects(f.engine.launch(p.id, 'Synthetic task', workspace), /plan_not_launchable/)
})
test('manual input, workspace changes and stale plans cannot launch', async () => {
  const f = fixture({ execution: true }); const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  await assert.rejects(f.engine.launch(p.id, 'Different task', workspace), /plan_changed/)
  await assert.rejects(f.engine.launch(p.id, 'Synthetic task', { ...workspace, id: 'other' }), /plan_changed/)
  f.data.set('plan:' + p.id, { ...p, expiresAt: 0 }); await assert.rejects(f.engine.launch(p.id, 'Synthetic task', workspace), /plan_not_launchable/)
  assert.equal(f.calls.length, 0)
})
test('unverified profile and failed audit block execution', async () => {
  const f = fixture({ execution: true, verified: false }); const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  await assert.rejects(f.engine.launch(p.id, 'Synthetic task', workspace), /profile_unverified/); assert.equal(f.calls.length, 0)
  const g = fixture({ execution: true }); const q = await g.engine.plan('Synthetic task', 'codex', workspace)
  const original = g.store.set; g.store.set = async (k, v) => { if (k === 'audit') throw new Error('synthetic failure'); return original(k, v) }
  await assert.rejects(g.engine.launch(q.id, 'Synthetic task', workspace)); assert.equal(g.calls.length, 0)
})
test('concurrent explicit launches consume a plan exactly once', async () => {
  const f = fixture({ execution: true }); const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  const result = await Promise.allSettled([f.engine.launch(p.id, 'Synthetic task', workspace), f.engine.launch(p.id, 'Synthetic task', workspace)])
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 1); assert.equal(f.calls.length, 1)
})
test('lost dispatch result is consumed permanently with no blind retry', async () => {
  const f = fixture({ execution: true }); let calls = 0; f.runtime.launch = async () => { calls++; throw new Error('synthetic timeout') }
  const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  assert.equal((await f.engine.launch(p.id, 'Synthetic task', workspace)).state, 'dispatch_unknown')
  await assert.rejects(f.engine.launch(p.id, 'Synthetic task', workspace)); assert.equal(calls, 1)
})
test('audit has no task text, key or raw exceptions', async () => {
  const f = fixture({ live: true }); await f.engine.plan('Synthetic private marker: private-task-779', 'codex', workspace)
  const audit = JSON.stringify(await f.engine.history()); assert.ok(!audit.includes('private-task-779')); assert.ok(!audit.includes('synthetic-secret'))
})
test('strict configuration rejects command injection, unknown fields, ultra and Cursor auto', () => {
  for (const change of [{ model: 'gpt-x; touch /tmp/no' }, { effort: 'ultra' }, { unknown: true }, { agent: 'cursor', model: 'auto', effort: null }]) {
    const c = structuredClone(DEFAULT_CONFIG); Object.assign(c.profiles[0]!, change); assert.throws(() => validateConfig(c))
  }
  assert.throws(() => parseJson('{"execution":false,"execution":true}'), /duplicate_json_key/)
  assert.deepEqual(JSON.parse(JSON.stringify(parseJson('{"x":[1,true,null,"hello"]}'))), { x: [1, true, null, 'hello'] })
})
test('price, schema, probabilities and cost validation are strict', () => {
  for (const pricing of [{ prompt: '', completion: '0' }, { prompt: '1', completion: '0' }, { prompt: '0', completion: '0', unknown: '0' }, { prompt: '0', completion: '1' }]) assert.throws(() => validatePrice({ data: { ...metadata.data, pricing } }))
  const bad = response() as any; bad.answers.profile.probabilities.deep = NaN; assert.throws(() => validateAnswer(bad, DEFAULT_CONFIG.profiles))
  assert.ok(!makeRequest('Synthetic', DEFAULT_CONFIG.profiles).includes('chat/completions'))
})
test('safe argv preserves hostile text, native Cursor alias and strips JEV credentials', () => {
  const task = '--model evil; $(echo nope)\nSynthetic task'
  const args = launchArgs(DEFAULT_CONFIG.profiles[0]!, task, workspace)
  assert.equal(args[args.indexOf('--prompt') + 1], 'Task submitted through Fairway for Orca:\n' + task)
  assert.equal(args.filter(x => x === '--model').length, 1)
  const cursor = { ...DEFAULT_CONFIG.profiles[0]!, agent: 'cursor' as const, model: 'gpt-native-high', effort: null }
  assert.ok(!launchArgs(cursor, task, workspace).includes('--effort'))
  assert.deepEqual(childEnvironment({ OPENROUTER_TOKEN: 'synthetic', OPENROUTER_API_KEY: 'synthetic', PATH: 'safe' }), { PATH: 'safe' })
  assert.equal(orcaExecutable({}, 'linux'), 'orca-ide')
})
test('Codex metadata must match both the model pair and the actual CLI version', async () => {
  const cache = { fetched_at: new Date().toISOString(), client_version: '0.synthetic', models: [{ slug: 'gpt-test', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] }] }
  const runtime = new NativeRuntime({}, async (_file, args) => { if (args[0] === 'debug') throw new Error('synthetic unsupported command'); return { code: 0, stdout: args[0] === 'account' ? '{"ok":true,"result":{"activeAccountId":null}}' : 'codex-cli 0.synthetic' } }, async () => JSON.stringify(cache))
  const profile = { ...DEFAULT_CONFIG.profiles[0]!, model: 'gpt-test' }
  assert.equal((await runtime.verify(profile)).verified, true)
  cache.client_version = 'older'; assert.equal((await runtime.verify(profile)).verified, false)
})
test('turning execution off during verification prevents a queued launch', async () => {
  const f = fixture({ execution: true }); const p = await f.engine.plan('Synthetic task', 'codex', workspace)
  let unblock: (() => void) | undefined
  f.runtime.verify = async () => { await new Promise<void>(r => { unblock = r }); return { verified: true, source: 'synthetic' } }
  const launching = f.engine.launch(p.id, 'Synthetic task', workspace)
  while (!unblock) await new Promise(r => setImmediate(r))
  await f.engine.saveConfig({ ...f.config, execution: false }); unblock()
  await assert.rejects(launching, /plan_changed/); assert.equal(f.calls.length, 0)
})
test('cancelling during metadata verification cannot resurrect a shadow plan', async () => {
  const f = fixture({ execution: true }); const id = randomUUID()
  let unblock: (() => void) | undefined
  f.runtime.verify = async () => { await new Promise<void>(r => { unblock = r }); return { verified: true, source: 'synthetic' } }
  const planning = f.engine.plan('Synthetic task', 'codex', workspace, id)
  while (!unblock) await new Promise(r => setImmediate(r))
  await f.engine.cancel(id); unblock()
  assert.equal((await planning).state, 'cancelled')
  await assert.rejects(f.engine.launch(id, 'Synthetic task', workspace), /plan_not_launchable/)
  assert.equal(f.calls.length, 0)
})
test('Codex verification uses the Orca-selected managed account instead of a mismatched system cache', async () => {
  const id = '00000000-0000-0000-0000-000000000001', paths: string[] = []
  const runner: ConstructorParameters<typeof NativeRuntime>[1] = async (_file, args) => { if (args[0] === 'debug') throw new Error('synthetic unsupported command'); return { code: 0, stdout: args[0] === 'account' ? JSON.stringify({ ok: true, result: { activeAccountId: id } }) : 'codex-cli 0.synthetic' } }
  const runtime = new NativeRuntime({ CODEX_HOME: '/synthetic-system-home' }, runner, async path => {
    paths.push(path); return JSON.stringify({ client_version: path.includes(id) ? '0.synthetic' : 'older', fetched_at: new Date().toISOString(), models: [{ slug: 'synthetic-model', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }] }] })
  })
  const result = await runtime.verify({ ...DEFAULT_CONFIG.profiles[1]!, model: 'synthetic-model' })
  assert.equal(result.verified, true); assert.equal(paths.length, 1); assert.ok(paths[0]!.includes(id)); assert.ok(paths[0]!.endsWith('models_cache.json'))
  assert.equal(codexMetadataHome({ ok: true, result: { activeAccountId: id, activeAccountIdsByRuntime: { host: null } } }, { CODEX_HOME: '/synthetic-system' }), '/synthetic-system')
  assert.throws(() => codexMetadataHome({ ok: true, result: { activeAccountId: '../outside' } }, {}))
})

test('Codex bundled catalog comes from a bounded metadata-only command, without touching shared caches', async () => {
  const calls: string[][] = []
  const runtime = new NativeRuntime({ OPENROUTER_API_KEY: 'synthetic-secret', OPENROUTER_TOKEN: 'synthetic-secret' }, async (file, args, options) => {
    calls.push([file, ...args]); assert.equal(options.timeout, 10000); assert.equal(options.maxBuffer, 2 * 1024 * 1024)
    assert.equal(options.env.OPENROUTER_API_KEY, undefined); assert.equal(options.env.OPENROUTER_TOKEN, undefined)
    return { code: 0, stdout: JSON.stringify({ models: [{ slug: 'gpt-test', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }], model_messages: { instructions: 'Synthetic ignored instructions' } }] }) }
  }, async () => { throw new Error('must not read or rewrite caches') })
  assert.deepEqual(await runtime.verify({ ...DEFAULT_CONFIG.profiles[0]!, model: 'gpt-test' }), { verified: true, source: 'codex_bundled_catalog' })
  assert.deepEqual(calls, [['codex', 'debug', 'models', '--bundled']])
})
test('Codex bundled catalog refuses absent models, hidden models and unsupported efforts without cache fallback', async () => {
  const catalog = { models: [{ slug: 'gpt-test', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] }] }
  const runtime = new NativeRuntime({}, async () => ({ code: 0, stdout: JSON.stringify(catalog) }), async () => { throw new Error('must not fall back') })
  assert.equal((await runtime.verify({ ...DEFAULT_CONFIG.profiles[0]!, model: 'missing' })).verified, false)
  assert.equal((await runtime.verify({ ...DEFAULT_CONFIG.profiles[1]!, model: 'gpt-test' })).verified, false)
  catalog.models[0]!.visibility = 'hidden'
  assert.equal((await runtime.verify({ ...DEFAULT_CONFIG.profiles[0]!, model: 'gpt-test' })).verified, false)
})
test('Codex bundled catalog rejects malformed, duplicate and oversized data instead of using cache', async () => {
  let stdout = '{"models":[],"models":[]}'
  const runtime = new NativeRuntime({}, async () => ({ code: 0, stdout }), async () => { throw new Error('must not fall back') })
  await assert.rejects(runtime.verify(DEFAULT_CONFIG.profiles[0]!), /duplicate_json_key/)
  stdout = JSON.stringify({ models: [{ slug: 'gpt-test' }, { slug: 'gpt-test' }] })
  await assert.rejects(runtime.verify({ ...DEFAULT_CONFIG.profiles[0]!, model: 'gpt-test' }), /invalid_codex_catalog/)
  stdout = ' '.repeat(2 * 1024 * 1024 + 1)
  await assert.rejects(runtime.verify(DEFAULT_CONFIG.profiles[0]!), /invalid_codex_catalog/)
})
test('Codex metadata command timeout still blocks a mismatched fallback catalog', async () => {
  const runtime = new NativeRuntime({}, async (_file, args) => {
    if (args[0] === 'debug') throw new Error('synthetic timeout')
    return { code: 0, stdout: args[0] === 'account' ? '{"ok":true,"result":{"activeAccountId":null}}' : 'codex-cli 0.new' }
  }, async () => JSON.stringify({ models: [], fetched_at: new Date().toISOString(), client_version: '0.old' }))
  assert.deepEqual(await runtime.verify(DEFAULT_CONFIG.profiles[0]!), { verified: false, source: 'codex_catalog_version_mismatch' })
})

test('Codex metadata output overflow is bounded by the process runner and never falls back', async () => {
  await assert.rejects(runFile(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], { env: {}, timeout: 1000, maxBuffer: 128 }), /command_output_too_large/)
  const runtime = new NativeRuntime({}, async () => { throw new RouterError('command_output_too_large') }, async () => { throw new Error('must not read fallback') })
  await assert.rejects(runtime.verify(DEFAULT_CONFIG.profiles[0]!), /command_output_too_large/)
})
test('direct Orca agent-launch response confirms one dispatch and never permits a duplicate', async () => {
  const f = fixture({ execution: true })
  const plan = await f.engine.plan('Synthetic launch contract', 'codex', workspace)
  const sent = await f.engine.launch(plan.id, 'Synthetic launch contract', workspace)
  assert.equal(sent.state, 'submitted'); assert.equal(sent.dispatch?.handle, 'orca_session_id:synthetic')
  await assert.rejects(f.engine.launch(plan.id, 'Synthetic launch contract', workspace), /plan_not_launchable/)
  assert.equal(f.calls.length, 1)
})
test('extended coordinator envelopes require a forced profile and never reach JEV; ordinary routing stays capped', async () => {
  const f = fixture({ live: true, execution: true }), task = 'x'.repeat(5000)
  await assert.rejects(f.engine.plan(task, 'codex', workspace), /invalid_task/)
  await assert.rejects(f.engine.plan(task, 'codex', workspace, randomUUID(), undefined, { coordinator: true }), /invalid_coordinator_plan/)
  const p = await f.engine.plan(task, 'auto', workspace, randomUUID(), undefined, { coordinator: true, profileId: 'standard' })
  assert.equal(p.purpose, 'coordinator'); assert.equal(p.reason, 'coordinator_profile'); assert.equal(f.traffic.length, 0)
  assert.equal((await f.engine.launch(p.id, task, workspace)).state, 'submitted')
  await assert.rejects(f.engine.plan('x'.repeat(65537), 'auto', workspace, randomUUID(), undefined, { coordinator: true, profileId: 'standard' }), /coordinator_prompt_too_large/)
})
test('unlimited JEV mode bypasses only aggregate caps and preserves cumulative accounting', async () => {
  const f = fixture({ live: true }); f.config.unlimitedJev = true; f.config.maxCalls = 0; f.config.budgetMicrousd = 0
  f.data.set('config', f.config); f.data.set('ledger', { calls: 105, reservedMicrousd: 105 * RESERVATION_MICROUSD })
  const p = await f.engine.plan('Synthetic unlimited decision', 'codex', workspace)
  assert.equal(p.reason, 'selected'); assert.equal(f.calls.length, 0)
  assert.deepEqual(await f.engine.ledger(), { calls: 106, reservedMicrousd: 106 * RESERVATION_MICROUSD })
  await f.engine.saveConfig({ ...f.config, unlimitedJev: false, maxCalls: 105 })
  assert.equal((await f.engine.plan('Synthetic capped again', 'codex', workspace)).reason, 'budget_exhausted')
  assert.equal((await f.engine.ledger()).calls, 106)
})
test('old configs retain limits, unlimited is explicitly boolean, and caller-selected finite caps support safe integers', () => {
  const legacy: Partial<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG); delete legacy.unlimitedJev
  assert.equal(validateConfig(legacy).unlimitedJev, false)
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, unlimitedJev: 'yes' }), /invalid_modes/)
  assert.equal(validateConfig({ ...DEFAULT_CONFIG, budgetMicrousd: 11000000, maxCalls: 1000 }).maxCalls, 1000)
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, budgetMicrousd: Number.MAX_SAFE_INTEGER + 1 }), /invalid_budget/)
})
test('unlimited decisions still require bounded per-request pricing and refuse corrupt accounting', async () => {
  let posts = 0
  const f = fixture({ live: true, transport: async (_url, args) => { if (args.body) posts++; return { data: { id: 'typesafe/jev-1.14', context_length: 262144, pricing: { prompt: '1', completion: '0' } } } } })
  f.config.unlimitedJev = true; f.data.set('config', f.config)
  assert.equal((await f.engine.plan('Synthetic pricing check', 'codex', workspace)).reason, 'pricing_unbounded'); assert.equal(posts, 0)
  f.data.set('ledger', { calls: Number.MAX_SAFE_INTEGER, reservedMicrousd: 0 })
  assert.equal((await f.engine.plan('Synthetic overflow check', 'codex', workspace)).reason, 'invalid_ledger'); assert.equal(posts, 0)
})

test('extended workflow prompts stay local while only the bounded routing brief reaches JEV', async () => {
  const f = fixture({ live: true, execution: true }), task = 'LOCAL-WORKFLOW-MARKER' + 'я'.repeat(3000), brief = 'Synthetic verification with dependency reports.'
  const p = await f.engine.plan(task, 'auto', workspace, undefined, undefined, { workflow: true, routingTask: brief, allowedAgents: ['codex'] })
  assert.equal(p.purpose, 'workflow'); assert.equal(p.state, 'shadow'); assert.equal(f.calls.length, 0)
  assert.equal(JSON.parse(f.traffic.find(t => t.body)!.body!).state.task_description, brief)
  assert.equal(JSON.stringify(f.traffic).includes('LOCAL-WORKFLOW-MARKER'), false)
  assert.equal(JSON.stringify(await f.engine.history()).includes('LOCAL-WORKFLOW-MARKER'), false)
  await f.engine.launch(p.id, task, workspace); assert.equal(f.calls.length, 1); assert.equal(f.calls[0]![1], task)
})
test('workflow prompt bounds and purpose guards do not widen direct task or JEV description limits', async () => {
  const f = fixture(), options = { workflow: true, routingTask: 'Synthetic brief', allowedAgents: ['codex' as const] }
  const p = await f.engine.plan('я'.repeat(32768), 'auto', workspace, undefined, undefined, options)
  assert.equal(p.purpose, 'workflow')
  await assert.rejects(f.engine.plan('я'.repeat(32769), 'auto', workspace, undefined, undefined, options), /workflow_prompt_too_large/)
  await assert.rejects(f.engine.plan('x'.repeat(4097), 'codex', workspace), /invalid_task/)
  await assert.rejects(f.engine.plan('x'.repeat(5000), 'auto', workspace, undefined, undefined, { ...options, routingTask: 'x'.repeat(4097) }), /invalid_task/)
  for (const bad of [{ workflow: true }, { ...options, allowedAgents: [] }, { ...options, allowedAgents: ['codex', 'codex'] }, { ...options, profileId: 'standard' }, { ...options, coordinator: true }]) await assert.rejects(f.engine.plan('x'.repeat(5000), 'auto', workspace, undefined, undefined, bad as any), /invalid_workflow_plan/)
  await assert.rejects(f.engine.plan('x'.repeat(5000), 'codex', workspace, undefined, undefined, options), /invalid_workflow_plan/)
  assert.equal(f.traffic.length, 0); assert.equal(f.calls.length, 0); assert.equal((await f.engine.ledger()).calls, 0)
})
