import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { DEFAULT_CONFIG, validateConfig } from './core/config.ts'
import type { Plan } from './core/types.ts'
import type { Status } from './protocol.ts'
import type { Workflow } from './core/workflow.ts'
import { locales, translate } from './core/i18n.ts'
const example: Plan = { id: 'a'.repeat(36), profile: DEFAULT_CONFIG.profiles[0]!, reason: 'offline', confidence: null, createdAt: 1, expiresAt: 9999999999999, configHash: '', taskHash: '', workspaceHash: '', evidence: { verified: true, source: 'synthetic_metadata' }, costUsd: null, reservedMicrousd: 0, state: 'shadow', observedModel: null, observedEffort: null }
function status(execution = false): Status { return { config: { ...DEFAULT_CONFIG, execution }, ledger: { calls: 0, reservedMicrousd: 0 }, keyPresent: false, workspace: 'synthetic', lastPlan: null, bridgePath: null, workflow: null, balance: null } }
test('panel defaults to shadow and picking a profile never launches', async () => {
  let launches = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.plan': () => example, 'fairway.cancel': () => ({ cancelled: true }), 'fairway.launch': () => { launches++; return { ...example, state: 'submitted' } } } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Task description' }, 'Synthetic task')
  await view.press({ text: 'Select profile' })
  assert.equal(view.find({ text: 'Launch through Orca' })?.props.disabled, true)
  assert.equal(launches, 0)
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
test('editing a task cancels a previous decision', async () => {
  let cancels = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.plan': () => example, 'fairway.cancel': () => { cancels++; return { cancelled: true } } } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Task description' }, 'Synthetic task'); await view.press({ text: 'Select profile' })
  await view.type({ label: 'Task description' }, ' changed')
  assert.equal(cancels, 1); assert.equal(view.find({ text: 'Launch through Orca' }), null)
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('settings form saves modes and dollar limits without JSON editing or execution', async () => {
  let saved: any = null, launches = 0
  const host = mockHost({ requests: {
    'fairway.status': () => status(),
    'fairway.config': ({ config }) => { saved = validateConfig(JSON.parse(config)); return { ...status(), config: saved } },
    'fairway.launch': () => { launches++; return example }
  } })
  const view = await mount(panel, { host })
  await view.select({ label: 'Section' }, 'settings')
  assert.equal(view.find({ label: 'Settings JSON' }), null)
  await view.toggle({ label: 'Allow paid JEV requests' })
  await view.toggle({ label: 'Allow explicit execution through Orca' })
  await view.type({ label: 'Total JEV budget, USD' }, '0,25', { replace: true })
  await view.type({ label: 'JEV attempt limit' }, '8', { replace: true })
  assert.equal(Boolean(saved), false)
  await view.press({ text: 'Save settings' })
  assert.equal(saved.live, true); assert.equal(saved.execution, true)
  assert.equal(saved.budgetMicrousd, 250000); assert.equal(saved.maxCalls, 8)
  assert.equal(launches, 0); assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, [])
  await view.unmount()
})
test('profile editor adds an exact Cursor alias, renames fallback and removes it safely', async () => {
  let saved: any = null
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.config': ({ config }) => { saved = validateConfig(JSON.parse(config)); return { ...status(), config: saved } } } })
  const view = await mount(panel, { host })
  await view.select({ label: 'Section' }, 'settings'); await view.press({ text: 'Add profile' })
  await view.select({ label: 'Profile agent' }, 'cursor')
  assert.equal(view.find({ label: 'Profile effort' }), null)
  await view.type({ label: 'Profile model' }, 'synthetic-high', { replace: true })
  await view.type({ label: 'When to choose this profile' }, 'Synthetic task class', { replace: true })
  await view.select({ label: 'Fallback profile' }, 'profile-1')
  await view.type({ label: 'Profile ID' }, 'cursor-test', { replace: true })
  await view.press({ text: 'Save settings' })
  assert.equal(saved.fallback, 'cursor-test'); assert.equal(saved.profiles[3].effort, null)
  assert.equal(saved.profiles[3].model, 'synthetic-high')
  await view.select({ label: 'Profile to edit' }, '3'); await view.press({ text: 'Delete profile' })
  await view.press({ text: 'Save settings' })
  assert.equal(saved.profiles.length, 3); assert.equal(saved.fallback, 'routine')
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('form rejects excessive budgets before saving and backend rejects an injected model', async () => {
  let saves = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.config': ({ config }) => { saves++; validateConfig(JSON.parse(config)); return status() } } })
  const view = await mount(panel, { host }); await view.select({ label: 'Section' }, 'settings')
  for (const text of ['10000000000', '-1', 'NaN', '0.0000001']) {
    await view.type({ label: 'Total JEV budget, USD' }, text, { replace: true }); await view.press({ text: 'Save settings' })
  }
  assert.equal(saves, 0)
  await view.type({ label: 'Total JEV budget, USD' }, '0.1', { replace: true })
  await view.type({ label: 'Profile model' }, 'synthetic; touch /tmp/no', { replace: true })
  await view.press({ text: 'Save settings' })
  assert.equal(saves, 1); assert.ok(view.find({ text: 'Enter an exact model ID without spaces or commands.' }))
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('changing the Pi model or effort clears operator confirmation', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'fairway.status': () => status() } }) })
  await view.select({ label: 'Section' }, 'settings'); await view.select({ label: 'Profile agent' }, 'pi')
  await view.type({ label: 'Profile model' }, 'synthetic/model', { replace: true })
  await view.toggle({ label: 'I verified this pair in Pi' })
  assert.equal(view.valueOf({ label: 'I verified this pair in Pi' }), true)
  await view.select({ label: 'Profile effort' }, 'high')
  assert.equal(view.valueOf({ label: 'I verified this pair in Pi' }), false)
  await view.toggle({ label: 'I verified this pair in Pi' })
  await view.type({ label: 'Profile model' }, 'synthetic/other-model', { replace: true })
  assert.equal(view.valueOf({ label: 'I verified this pair in Pi' }), false)
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('workflow preparation never launches a coordinator automatically', async () => {
  let prepares = 0, actions = 0, workflow: any = null
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(), workflow }),
    'fairway.workflow.create': () => { prepares++; workflow = { id: 'a'.repeat(36), task: 'Synthetic', workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic', coordinator: example, analysis: null, approvedHash: null, cancelled: false, runs: {} }; return workflow },
    'fairway.workflow.action': () => { actions++; throw new Error('must not run automatically') }
  } })
  const view = await mount(panel, { host }); await view.select({ label: 'Section' }, 'workflow')
  await view.type({ label: 'Coordinator task' }, 'Synthetic https://example.invalid/docs')
  await view.press({ text: 'Prepare analysis' })
  assert.equal(prepares, 1); assert.equal(actions, 0)
  assert.equal(view.find({ text: 'Launch coordinator through Orca' })?.props.disabled, true)
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
test('all host locales translate settings and workflow controls without changing user data or executing', async () => {
  for (const locale of locales) {
    let requests = 0
    const config = structuredClone(DEFAULT_CONFIG)
    config.profiles[0]!.description = 'USER-AUTHORED-MARKER'
    const host = mockHost({ requests: {
      'fairway.status': () => ({ ...status(), config }),
      'fairway.plan': () => { requests++; return example },
      'fairway.workflow.create': () => { requests++; throw new Error('not expected') }
    } })
    const tr = (message: Parameters<typeof translate>[1]) => translate(locale, message)
    const view = await mount(panel, { host, locale })
    await view.select({ label: tr('Section') }, 'settings')
    assert.equal(view.valueOf({ label: tr('When to choose this profile') }), 'USER-AUTHORED-MARKER')
    assert.ok(view.find({ text: tr('Save settings') }))
    await view.type({ label: tr('Total JEV budget, USD') }, '-1', { replace: true })
    await view.press({ text: tr('Save settings') })
    assert.ok(view.find({ text: tr('Budget must be nonnegative, with up to 6 decimal places.') }))
    await view.select({ label: tr('Section') }, 'workflow')
    assert.ok(view.find({ label: tr('Coordinator task') }))
    assert.equal(view.find({ text: tr('Prepare analysis') })?.props.disabled, true)
    assert.equal(requests, 0, locale)
    assert.deepEqual(view.errors, [], locale); assert.deepEqual(view.refusals, [], locale)
    await view.unmount()
  }
})
test('balance refresh is explicit and a restricted account never displays fabricated zero funds', async () => {
  let requests = 0
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(), keyPresent: true }),
    'fairway.balance': () => { requests++; return { account: { state: 'restricted', remainingUsd: null }, key: { state: 'available', remainingUsd: 4 }, checkedAt: Date.now() } }
  } })
  const view = await mount(panel, { host })
  try {
    assert.equal(requests, 0)
    await view.press({ text: 'Refresh balance' }); assert.equal(requests, 1)
    const tree = JSON.stringify(view.tree())
    assert.ok(tree.includes('Management key required')); assert.ok(tree.includes('$4.0000'))
    assert.ok(view.find({ text: 'Account balance', type: 'Text' }))
    assert.ok(view.find({ text: 'Management key required', type: 'Text' }))
    assert.ok(!tree.includes('$0.0000'))
    assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, [])
  } finally { await view.unmount() }
})
test('a wrapped analysis error shows the actionable message rather than the generic failure', async () => {
  const workflow: Workflow = { id: 'a'.repeat(36), task: 'Synthetic', workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic', coordinator: example, analysis: null, approvedHash: null, cancelled: false, runs: {} }
  const host = mockHost({ requests: { 'fairway.status': () => ({ ...status(), workflow }), 'fairway.workflow.action': input => { assert.equal(Object.hasOwn(input, 'stepId'), false); throw Object.assign(new Error('Plugin request failed: analysis_not_found'), { code: 'analysis_not_found' }) } } })
  const view = await mount(panel, { host }); await view.select({ label: 'Section' }, 'workflow')
  await view.press({ text: 'Read coordinator analysis' })
  assert.ok(view.find({ text: 'The coordinator has not written the analysis file yet.' })); assert.deepEqual(view.errors, [])
  await view.unmount()
})
test('refreshing an unverified coordinator enables its launch without dispatching it', async () => {
  let actions = 0
  let workflow: Workflow = { id: 'a'.repeat(36), task: 'Synthetic', workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic', coordinator: { ...example, evidence: { verified: false, source: 'codex_catalog_version_mismatch' } }, analysis: null, approvedHash: null, cancelled: false, runs: {} }
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), workflow }),
    'fairway.workflow.action': input => { actions++; assert.equal(input.action, 'refreshCoordinator'); assert.equal(Object.hasOwn(input, 'stepId'), false); workflow = { ...workflow, coordinator: example }; return workflow }
  } })
  const view = await mount(panel, { host }); await view.select({ label: 'Section' }, 'workflow')
  assert.equal(view.find({ text: 'Launch coordinator through Orca' })?.props.disabled, true)
  await view.press({ text: 'Refresh coordinator profile' })
  assert.equal(view.find({ text: 'Launch coordinator through Orca' })?.props.disabled, false); assert.equal(actions, 1)
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
test('failed analysis read shows safe field diagnostics; a successful retry clears both errors', async () => {
  let reads = 0, inspections = 0
  let workflow: Workflow = { id: 'a'.repeat(36), task: 'Synthetic', workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic', coordinator: example, analysis: null, approvedHash: null, cancelled: false, runs: {} }
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(), workflow }),
    'fairway.workflow.action': input => {
      assert.equal(input.action, 'read'); reads++
      if (reads === 1) throw Object.assign(new Error('invalid_analysis'), { code: 'invalid_analysis' })
      workflow = { ...workflow, analysis: { version: 1, summary: 'Synthetic loaded analysis', assumptions: [], questions: [], sources: [], steps: [] } }; return workflow
    },
    'fairway.workflow.inspect': input => { assert.equal(input.id, workflow.id); inspections++; return { valid: false, issue: { path: 'sources', rule: 'items', actual: 33, limit: 32 } } }
  } })
  const view = await mount(panel, { host }); await view.select({ label: 'Section' }, 'workflow')
  await view.press({ text: 'Read coordinator analysis' }); assert.equal(inspections, 1)
  assert.ok(JSON.stringify(view.tree()).includes('Analysis validation details')); assert.ok(JSON.stringify(view.tree()).includes('sources'))
  await view.press({ text: 'Read coordinator analysis' }); assert.equal(reads, 2)
  assert.ok(!JSON.stringify(view.tree()).includes('Analysis validation details'))
  assert.ok(!JSON.stringify(view.tree()).includes('Operation stopped'))
  assert.deepEqual(view.errors, []); await view.unmount()
})

test('F01: every locale saves the none option as the machine value', async () => {
  for (const locale of locales) {
    let effort: unknown
    const tr = (m: Parameters<typeof translate>[1]) => translate(locale, m)
    const view = await mount(panel, { locale, host: mockHost({ requests: {
      'fairway.status': () => status(),
      'fairway.config': ({ config }) => { const c = validateConfig(JSON.parse(config)); effort = c.profiles[0]!.effort; return { ...status(), config: c } }
    } }) })
    await view.select({ label: tr('Section') }, 'settings')
    await view.select({ label: tr('Profile effort') }, 'none')
    await view.press({ text: tr('Save settings') })
    assert.equal(effort, 'none', locale); assert.deepEqual(view.errors, []); await view.unmount()
  }
})
test('F02: empty save cannot delete a key; explicit delete is separate and confirmed', async () => {
  const keys: string[] = []
  const view = await mount(panel, { host: mockHost({ requests: {
    'fairway.status': () => ({ ...status(), keyPresent: true }),
    'fairway.key': ({ key }) => { keys.push(key); return { present: !!key } }
  } }) })
  await view.select({ label: 'Section' }, 'settings')
  assert.equal(view.find({ text: 'Save key' })?.props.disabled, true)
  assert.equal(keys.length, 0)
  await view.type({ label: 'OpenRouter key' }, 'SYNTHETIC-KEY')
  await view.press({ text: 'Save key' }); assert.deepEqual(keys, ['SYNTHETIC-KEY'])
  assert.equal(view.valueOf({ label: 'OpenRouter key' }), '')
  assert.ok(view.find({ text: 'Key updated' }))
  await view.press({ text: 'Delete key' }); assert.deepEqual(keys, ['SYNTHETIC-KEY', ''])
  assert.ok(!JSON.stringify(view.persisted).includes('SYNTHETIC-KEY')); await view.unmount()
})
test('F03: workspace drafts survive remount, secrets do not, and clear removes drafts', async () => {
  const host = mockHost({ requests: { 'fairway.status': () => status() } })
  let view = await mount(panel, { host })
  await view.type({ label: 'Task description' }, 'LOCAL-DRAFT')
  await view.select({ label: 'Section' }, 'workflow'); await view.type({ label: 'Coordinator task' }, 'COORDINATOR-DRAFT')
  await view.select({ label: 'Section' }, 'settings')
  await view.type({ label: 'Total JEV budget, USD' }, '0.25', { replace: true })
  await view.type({ label: 'OpenRouter key' }, 'SECRET-DRAFT')
  const persisted = view.persisted; assert.ok(!JSON.stringify(persisted).includes('SECRET-DRAFT'))
  await view.unmount(); view = await mount(panel, { host, persisted })
  assert.equal(view.valueOf({ label: 'Total JEV budget, USD' }), '0.25')
  assert.equal(view.valueOf({ label: 'OpenRouter key' }), '')
  await view.select({ label: 'Section' }, 'task'); assert.equal(view.valueOf({ label: 'Task description' }), 'LOCAL-DRAFT')
  await view.select({ label: 'Section' }, 'workflow'); assert.equal(view.valueOf({ label: 'Coordinator task' }), 'COORDINATOR-DRAFT')
  await view.select({ label: 'Section' }, 'settings'); await view.press({ text: 'Clear drafts' })
  const cleared = view.persisted; await view.unmount()
  view = await mount(panel, { host, persisted: cleared })
  assert.equal(view.valueOf({ label: 'Total JEV budget, USD' }), '0.1')
  await view.select({ label: 'Section' }, 'task'); assert.equal(view.valueOf({ label: 'Task description' }), '')
  await view.select({ label: 'Section' }, 'workflow'); assert.equal(view.valueOf({ label: 'Coordinator task' }), '')
  await view.unmount()
})
test('F04/F05: restored plans are read only; lost launch responses stay blocked through refresh and remount', async () => {
  let launches = 0
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), lastPlan: example }), 'fairway.plan': () => example,
    'fairway.cancel': () => ({ cancelled: true }),
    'fairway.launch': () => { launches++; throw new Error('synthetic timeout') }
  } })
  let view = await mount(panel, { host })
  assert.equal(view.find({ text: 'Launch through Orca' })?.props.disabled, true)
  await view.type({ label: 'Task description' }, 'Synthetic'); await view.press({ text: 'Select profile' })
  assert.equal(view.find({ text: 'Launch through Orca' })?.props.disabled, false)
  await view.press({ text: 'Launch through Orca' })
  assert.equal(launches, 1); assert.equal(view.find({ text: 'Launch through Orca' })?.props.disabled, true)
  await view.press({ text: 'Refresh status' })
  assert.equal(view.find({ text: 'Launch through Orca' })?.props.disabled, true)
  assert.equal(view.find({ text: 'Select profile' })?.props.disabled, true)
  const persisted = view.persisted; await view.unmount(); view = await mount(panel, { host, persisted })
  assert.equal(view.find({ text: 'Launch through Orca' })?.props.disabled, true)
  assert.ok(JSON.stringify(view.tree()).includes('The dispatch outcome is unknown. Inspect Orca'))
  assert.equal(launches, 1); await view.unmount()
})
test('F08: balance errors are local and a successful retry clears them without erasing another error', async () => {
  let reads = 0
  const view = await mount(panel, { host: mockHost({ requests: {
    'fairway.status': () => ({ ...status(), keyPresent: true }),
    'fairway.plan': () => { throw new Error('synthetic failure') },
    'fairway.balance': () => { if (++reads === 1) throw new Error('synthetic failure'); return { account: { state: 'available', remainingUsd: 4 }, key: { state: 'unlimited', remainingUsd: null }, checkedAt: 1 } }
  } }) })
  await view.type({ label: 'Task description' }, 'Synthetic'); await view.press({ text: 'Select profile' })
  await view.press({ text: 'Refresh balance' }); assert.ok(view.find({ text: 'Unable to refresh balance. Try again.' }))
  await view.press({ text: 'Refresh balance' }); assert.equal(view.find({ text: 'Unable to refresh balance. Try again.' }), null)
  assert.ok(JSON.stringify(view.tree()).includes('$4.0000')); assert.ok(JSON.stringify(view.tree()).includes('Operation stopped'))
  await view.unmount()
})
test('F09: multibyte task and coordinator inputs block requests before byte limits are exceeded', async () => {
  let requests = 0
  const view = await mount(panel, { host: mockHost({ requests: { 'fairway.status': () => status(), 'fairway.plan': () => { requests++; return example } } }) })
  await view.type({ label: 'Task description' }, 'я'.repeat(2049)); assert.equal(view.find({ text: 'Select profile' })?.props.disabled, true)
  await view.type({ label: 'Task description' }, '😀'.repeat(1024), { replace: true }); assert.equal(view.find({ text: 'Select profile' })?.props.disabled, false)
  await view.select({ label: 'Section' }, 'workflow'); await view.type({ label: 'Coordinator task' }, 'я'.repeat(4097))
  assert.equal(view.find({ text: 'Prepare analysis' })?.props.disabled, true)
  await view.type({ label: 'Coordinator task' }, 'я'.repeat(1693), { replace: true })
  assert.equal(view.find({ text: 'Prepare analysis' })?.props.disabled, false)
  assert.ok(JSON.stringify(view.tree()).includes('3386'))
  assert.equal(requests, 0); await view.unmount()
})
test('F10: a restored audit tab loads events and distinguishes failure from emptiness', async () => {
  let reads = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.history': () => { if (++reads === 1) throw new Error('synthetic failure'); return { json: '[]' } } } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'history' } } })
  assert.equal(reads, 1); assert.ok(view.find({ text: 'Unable to load events. Try again.' }))
  // Two refresh buttons exist; the journal one is first in the rendered tree.
  await view.press({ text: 'Refresh status' }); assert.equal(reads, 2); assert.ok(view.find({ text: 'No events yet' }))
  await view.unmount()
})

function auditedWorkflow(state: 'planned' | 'submitted' | 'dispatch_unknown' | 'completed' = 'planned'): Workflow {
  return { id: 'b'.repeat(36), workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, task: 'Synthetic', artifact: '/synthetic/analysis.json', coordinatorTask: 'Synthetic', coordinator: { ...example, state: 'submitted' }, approvedHash: 'approved', cancelled: false,
    analysis: { version: 1, summary: 'Synthetic analysis', assumptions: [], questions: [], sources: [], steps: [
      { id: 'one', title: 'First step', instructions: 'Long synthetic instructions', context: '', acceptance: 'Checks passed', routingBrief: 'Synthetic brief', allowedAgents: ['codex'], dependsOn: [] },
      { id: 'two', title: 'Dependent step', instructions: 'Synthetic', context: '', acceptance: 'Checked', routingBrief: 'Synthetic brief', allowedAgents: ['codex'], dependsOn: ['one'] }
    ] }, runs: { one: { state, plan: { ...example, state: state === 'submitted' ? 'submitted' : state === 'dispatch_unknown' ? 'dispatch_unknown' : 'shadow' }, review: state === 'completed' ? 'Checked' : null }, two: { state: 'waiting', plan: null, review: null } } }
}
test('F06/F09/F11: review stays above instructions, persists by step, and accepting reveals the next step', async () => {
  let workflow = auditedWorkflow('submitted'), reviews = 0
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), workflow }),
    'fairway.workflow.action': input => { assert.equal(input.action, 'review'); reviews++; workflow = auditedWorkflow('completed'); return workflow }
  } })
  let view = await mount(panel, { host, persisted: { plugin: { tab: 'workflow' } } })
  assert.equal(view.find({ text: 'Select agent: two' }), null)
  await view.toggle({ label: 'Dependent step', type: 'Collapsible' })
  assert.equal(view.find({ text: 'Select agent: two' })?.props.disabled, true)
  assert.ok(JSON.stringify(view.tree()).includes('Review and accept dependency results first.'))
  await view.type({ label: 'Reviewed result: one' }, 'я'.repeat(81)); assert.equal(view.find({ text: 'Accept result: one' })?.props.disabled, true)
  await view.type({ label: 'Reviewed result: one' }, 'Verified', { replace: true })
  const persisted = view.persisted; await view.unmount(); view = await mount(panel, { host, persisted })
  assert.equal(view.valueOf({ label: 'Reviewed result: one' }), 'Verified')
  const tree = JSON.stringify(view.tree()); assert.ok(tree.indexOf('Reviewed result: one') < tree.indexOf('Long synthetic instructions'))
  await view.press({ text: 'Accept result: one' }); assert.equal(reviews, 1)
  assert.equal(view.find({ text: 'Select agent: two' })?.props.disabled, false)
  assert.equal(view.find({ text: 'Accept result: one' }), null)
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
test('F04/F06: lost workflow launch reply locks dispatches and survives remount without retry', async () => {
  let actions = 0
  const workflow = auditedWorkflow()
  const host = mockHost({ requests: { 'fairway.status': () => ({ ...status(true), workflow }), 'fairway.workflow.action': () => { actions++; throw new Error('synthetic timeout') } } })
  let view = await mount(panel, { host, persisted: { plugin: { tab: 'workflow' } } })
  await view.press({ text: 'Launch subtask: one' }); assert.equal(actions, 1)
  assert.equal(view.find({ text: 'Launch subtask: one' })?.props.disabled, true)
  assert.equal(view.find({ text: 'Select agent: one' })?.props.disabled, true)
  const persisted = view.persisted; await view.unmount(); view = await mount(panel, { host, persisted })
  assert.equal(view.find({ text: 'Launch subtask: one' })?.props.disabled, true)
  assert.ok(JSON.stringify(view.tree()).includes('The dispatch outcome is unknown. Further dispatch'))
  assert.equal(actions, 1); assert.deepEqual(view.errors, []); await view.unmount()
})
test('F07: workflow waiting identifies the operation and prevents duplicate preparation', async () => {
  let resolve!: (value: Workflow) => void
  const request = new Promise<Workflow>(r => { resolve = r })
  const view = await mount(panel, { host: mockHost({ requests: { 'fairway.status': () => status(), 'fairway.workflow.create': () => request } }), persisted: { plugin: { tab: 'workflow' } } })
  await view.type({ label: 'Coordinator task' }, 'Synthetic')
  const press = view.press({ text: 'Prepare analysis' })
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  assert.equal(view.find({ type: 'Spinner' })?.props.label, 'Prepare analysis')
  assert.equal(view.find({ text: 'Prepare analysis' })?.props.disabled, true)
  resolve(auditedWorkflow()); await press; assert.equal(view.find({ type: 'Spinner' }), null)
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('F02: both key actions stay disabled while a key update is pending', async () => {
  let resolve!: (value: { present: boolean }) => void
  const update = new Promise<{ present: boolean }>(r => { resolve = r })
  const view = await mount(panel, { host: mockHost({ requests: { 'fairway.status': () => ({ ...status(), keyPresent: true }), 'fairway.key': () => update } }) })
  await view.select({ label: 'Section' }, 'settings'); await view.type({ label: 'OpenRouter key' }, 'SYNTHETIC-KEY')
  const press = view.press({ text: 'Save key' }); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  assert.equal(view.find({ text: 'Save key' })?.props.disabled, true)
  assert.equal(view.find({ text: 'Delete key' })?.props.disabled, true)
  resolve({ present: true }); await press; assert.ok(view.find({ text: 'Key updated' })); await view.unmount()
})
test('F04: a confirmed workflow dispatch unlocks review after reconciliation without another dispatch', async () => {
  let workflow = auditedWorkflow(), actions = 0
  const host = mockHost({ requests: { 'fairway.status': () => ({ ...status(true), workflow }), 'fairway.workflow.action': () => { actions++; workflow = auditedWorkflow('submitted'); throw new Error('synthetic lost reply') } } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'workflow' } } })
  await view.press({ text: 'Launch subtask: one' })
  await view.type({ label: 'Reviewed result: one' }, 'Checked')
  assert.equal(view.find({ text: 'Accept result: one' })?.props.disabled, false)
  assert.equal(view.find({ text: 'Launch subtask: one' })?.props.disabled, true)
  assert.equal(actions, 1); await view.unmount()
})
test('one automatic-plan action authorizes the graph and hides manual review for contracted steps', async () => {
  const automaticWorkspace = { id: 'synthetic', path: '/synthetic-project', host: 'local' as const }
  const analysis = { version: 1 as const, summary: 'Synthetic automatic plan', assumptions: [], questions: [], sources: [], steps: [{ id: 'first', title: 'Synthetic first step', instructions: 'Synthetic work', acceptance: 'Synthetic check', context: '', routingBrief: 'Synthetic routine work', allowedAgents: ['codex' as const], dependsOn: [] }] }
  let workflow: Workflow = { id: 'a'.repeat(36), task: 'Synthetic', workspace: automaticWorkspace, artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic', coordinator: example, analysis, approvedHash: null, cancelled: false, runs: {} }, calls = 0
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), workflow }),
    'fairway.workflow.action': input => {
      assert.equal(input.action, 'startAutomatic'); calls++
      workflow = { ...workflow, approvedHash: 'synthetic', automatic: { state: 'running', reason: null, approvedHash: 'synthetic', configHash: 'synthetic', expiresAt: Date.now() + 100000, dispatches: 1, limit: 1 }, runs: { first: { state: 'submitted', plan: { ...example, state: 'submitted' }, review: null, result: { path: '/synthetic-private/result.json', token: 'synthetic' } } } }
      return workflow
    }
  } })
  const view = await mount(panel, { host });
  try {
    await view.select({ label: 'Section' }, 'workflow')
    assert.equal(calls, 0); await view.press({ text: 'Run plan automatically', type: 'Button' }); assert.equal(calls, 1)
    assert.ok(view.find({ text: 'Pause automatic execution' }))
    assert.equal(view.find({ label: 'Reviewed result: first' }), null)
    assert.ok(JSON.stringify(view.tree()).includes('Waiting for the executor to finish and report checks.'))
    assert.deepEqual(view.errors, [])
  } finally { await view.unmount() }
})
test('unlimited JEV is an explicit saved switch, disables cap fields and preserves the existing counters', async () => {
  let config = { ...DEFAULT_CONFIG, live: true }, saves = 0, actions = 0
  const workflow = auditedWorkflow('completed'); workflow.runs.two = { state: 'planned', plan: { ...example, reason: 'budget_exhausted' }, review: null }
  workflow.automatic = { state: 'paused', reason: 'routing_failed', configHash: 'synthetic', approvedHash: workflow.approvedHash!, expiresAt: Date.now() + 100000, dispatches: 1, limit: 2 }
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), config: { ...config, execution: true }, keyPresent: true, workflow, ledger: { calls: 5, reservedMicrousd: 65540 } }),
    'fairway.config': input => { config = validateConfig(JSON.parse(input.config)); saves++; return { ...status(true), config: { ...config, execution: true }, keyPresent: true, workflow, ledger: { calls: 5, reservedMicrousd: 65540 } } },
    'fairway.workflow.action': () => { actions++; throw new Error('must not continue automatically') }
  } })
  const view = await mount(panel, { host })
  try {
  await view.select({ label: 'Section' }, 'workflow')
  assert.equal(view.find({ type: 'Button', text: 'Continue automatically' })?.props.disabled, true)
  assert.ok(JSON.stringify(view.tree()).includes('The JEV allowance cannot cover the remaining steps.'))
  await view.press({ type: 'Button', text: 'Settings' })
  await view.toggle({ label: 'Unlimited JEV decisions' })
  assert.equal(saves, 0); assert.equal(view.find({ label: 'Total JEV budget, USD' })?.props.disabled, true)
  await view.press({ text: 'Save settings' }); assert.equal(saves, 1); assert.equal(config.unlimitedJev, true)
  await view.select({ label: 'Section' }, 'workflow')
  assert.equal(view.find({ type: 'Button', text: 'Continue automatically' })?.props.disabled, false)
  assert.ok(JSON.stringify(view.tree()).includes('Unlimited')); assert.ok(JSON.stringify(view.tree()).includes('0.065540'))
  assert.equal(actions, 0); assert.deepEqual(view.errors, [])
  } finally { await view.unmount() }
})

test('automatic low-confidence fallback is disclosed without dispatching on panel load', async () => {
  const workflow = auditedWorkflow('completed')
  workflow.runs.two = { state: 'submitted', plan: { ...example, profile: DEFAULT_CONFIG.profiles[1]!, state: 'submitted', reason: 'low_confidence_fallback', confidence: .4 }, review: null, result: { path: '/synthetic-private/result.json', token: 'synthetic' } }
  workflow.automatic = { state: 'running', reason: null, configHash: 'synthetic', approvedHash: workflow.approvedHash!, expiresAt: Date.now() + 100000, dispatches: 2, limit: 2 }
  let actions = 0
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), workflow }),
    'fairway.workflow.action': () => { actions++; throw new Error('must not launch from render') }
  } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'workflow' } } })
  try {
    assert.ok(JSON.stringify(view.tree()).includes('Low JEV confidence. Using the configured fallback profile.'))
    assert.equal(actions, 0); assert.deepEqual(view.errors, [])
  } finally { await view.unmount() }
})

test('profile levels require an explicit save, preserve unrelated settings and support unranked legacy profiles', async () => {
  let config = structuredClone(DEFAULT_CONFIG), actions = 0, saves = 0
  delete config.profiles[0]!.level
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(), config }),
    'fairway.config': input => { config = validateConfig(JSON.parse(input.config)); saves++; return { ...status(), config } },
    'fairway.workflow.action': () => { actions++; throw new Error('must not execute') }
  } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'settings' } } })
  try {
    assert.equal(view.find({ label: 'Profile level' })?.props.value, 'unranked')
    await view.select({ label: 'Profile level' }, 'routine'); assert.equal(saves, 0)
    await view.press({ text: 'Save settings' }); assert.equal(config.profiles[0]!.level, 'routine')
    assert.equal(config.fallback, DEFAULT_CONFIG.fallback); assert.equal(config.live, false); assert.equal(config.execution, false)
    await view.select({ label: 'Profile level' }, 'unranked'); await view.press({ text: 'Save settings' })
    assert.equal(config.profiles[0]!.level, null); assert.equal(saves, 2); assert.equal(actions, 0); assert.deepEqual(view.errors, [])
  } finally { await view.unmount() }
})
test('automatic ranked low-confidence selection is disclosed without any launch on panel load', async () => {
  const workflow = auditedWorkflow('completed')
  workflow.runs.two = { state: 'submitted', plan: { ...example, profile: DEFAULT_CONFIG.profiles[2]!, state: 'submitted', reason: 'low_confidence_ranked', confidence: .4 }, review: null, result: { path: '/synthetic-private/result.json', token: 'synthetic' } }
  workflow.automatic = { state: 'running', reason: null, configHash: 'synthetic', approvedHash: workflow.approvedHash!, expiresAt: Date.now() + 100000, dispatches: 2, limit: 2 }
  let actions = 0
  const host = mockHost({ requests: { 'fairway.status': () => ({ ...status(true), workflow }), 'fairway.workflow.action': () => { actions++; throw new Error('must not execute') } } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'workflow' } } })
  try {
    assert.ok(JSON.stringify(view.tree()).includes('Low JEV confidence. The leading choice meets the fallback level.'))
    assert.equal(actions, 0); assert.deepEqual(view.errors, [])
  } finally { await view.unmount() }
})

test('executor completion and findings are displayed separately; reading a report neither accepts nor launches', async () => {
  const workflow = auditedWorkflow('completed')
  workflow.runs.two = { state: 'submitted', plan: { ...example, state: 'submitted' }, review: null, result: { path: '/synthetic-private/result.json', token: 'synthetic' } }
  workflow.automatic = { state: 'paused', reason: 'checks_failed', configHash: 'synthetic', approvedHash: workflow.approvedHash!, expiresAt: Date.now() + 100000, dispatches: 2, limit: 2 }
  const actions: string[] = []
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(true), workflow }),
    'fairway.workflow.action': input => {
      actions.push(input.action)
      assert.equal(input.action, 'inspectResult'); assert.equal(input.stepId, 'two')
      workflow.runs.two!.outcome = { status: 'completed', summary: 'Synthetic audit completed', checks: [{ name: 'Audit delivered', status: 'passed', evidence: 'Synthetic report' }], findings: [{ severity: 'P1', summary: 'Synthetic product defect remains', evidence: 'Synthetic evidence' }], questions: [] }
      return workflow
    }
  } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'workflow' } } })
  try {
    assert.equal(actions.length, 0)
    await view.press({ text: 'Read executor report' }); assert.deepEqual(actions, ['inspectResult'])
    let tree = JSON.stringify(view.tree()); assert.ok(tree.includes('Executor report'))
    await view.toggle({ label: 'Executor report', type: 'Collapsible' })
    tree = JSON.stringify(view.tree()); assert.ok(tree.includes('Step completion:')); assert.ok(tree.includes('Audit findings:'))
    assert.ok(tree.includes('Synthetic product defect remains')); assert.ok(tree.includes('Audit delivered'))
    assert.equal(workflow.runs.two!.state, 'submitted'); assert.deepEqual(view.errors, [])
  } finally { await view.unmount() }
})
