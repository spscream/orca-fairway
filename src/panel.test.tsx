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
  for (const text of ['11', '-1', 'NaN', '0.0000001']) {
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
    await view.type({ label: tr('Total JEV budget, USD') }, '11', { replace: true })
    await view.press({ text: tr('Save settings') })
    assert.ok(view.find({ text: tr('Budget: 0–10 USD, with up to 6 decimal places.') }))
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
  assert.equal(requests, 0)
  await view.press({ text: 'Refresh balance' }); assert.equal(requests, 1)
  const tree = JSON.stringify(view.tree())
  assert.ok(tree.includes('Management key required')); assert.ok(tree.includes('$4.0000'))
  const items = view.findAll({ type: 'KeyValue' }).flatMap(node => (node.props.items ?? []) as { label: string; value: string }[])
  assert.equal(items.find(item => item.label === 'Account balance')?.value, 'Management key required')
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
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
