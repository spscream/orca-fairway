import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { DEFAULT_CONFIG, validateConfig } from './core/config.ts'
import type { Plan } from './core/types.ts'
import type { Status } from './protocol.ts'
const example: Plan = { id: 'a'.repeat(36), profile: DEFAULT_CONFIG.profiles[0]!, reason: 'offline', confidence: null, createdAt: 1, expiresAt: 9999999999999, configHash: '', taskHash: '', workspaceHash: '', evidence: { verified: true, source: 'synthetic_metadata' }, costUsd: null, reservedMicrousd: 0, state: 'shadow', observedModel: null, observedEffort: null }
function status(execution = false): Status { return { config: { ...DEFAULT_CONFIG, execution }, ledger: { calls: 0, reservedMicrousd: 0 }, keyPresent: false, workspace: 'synthetic', lastPlan: null, bridgePath: null, workflow: null } }
test('panel defaults to shadow and picking a profile never launches', async () => {
  let launches = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.plan': () => example, 'fairway.cancel': () => ({ cancelled: true }), 'fairway.launch': () => { launches++; return { ...example, state: 'submitted' } } } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Описание задачи' }, 'Synthetic task')
  await view.press({ text: 'Подобрать профиль' })
  assert.equal(view.find({ text: 'Запустить через Orca' })?.props.disabled, true)
  assert.equal(launches, 0)
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
test('editing a task cancels a previous decision', async () => {
  let cancels = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.plan': () => example, 'fairway.cancel': () => { cancels++; return { cancelled: true } } } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Описание задачи' }, 'Synthetic task'); await view.press({ text: 'Подобрать профиль' })
  await view.type({ label: 'Описание задачи' }, ' changed')
  assert.equal(cancels, 1); assert.equal(view.find({ text: 'Запустить через Orca' }), null)
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
  await view.select({ label: 'Раздел' }, 'settings')
  assert.equal(view.find({ label: 'Настройки JSON' }), null)
  await view.toggle({ label: 'Разрешить платные запросы JEV' })
  await view.toggle({ label: 'Разрешить явный запуск через Orca' })
  await view.type({ label: 'Общий бюджет JEV, USD' }, '0,25', { replace: true })
  await view.type({ label: 'Лимит попыток JEV' }, '8', { replace: true })
  assert.equal(Boolean(saved), false)
  await view.press({ text: 'Сохранить настройки' })
  assert.equal(saved.live, true); assert.equal(saved.execution, true)
  assert.equal(saved.budgetMicrousd, 250000); assert.equal(saved.maxCalls, 8)
  assert.equal(launches, 0); assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, [])
  await view.unmount()
})
test('profile editor adds an exact Cursor alias, renames fallback and removes it safely', async () => {
  let saved: any = null
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.config': ({ config }) => { saved = validateConfig(JSON.parse(config)); return { ...status(), config: saved } } } })
  const view = await mount(panel, { host })
  await view.select({ label: 'Раздел' }, 'settings'); await view.press({ text: 'Добавить профиль' })
  await view.select({ label: 'Агент профиля' }, 'cursor')
  assert.equal(view.find({ label: 'Усилие профиля' }), null)
  await view.type({ label: 'Модель профиля' }, 'synthetic-high', { replace: true })
  await view.type({ label: 'Когда выбирать профиль' }, 'Synthetic task class', { replace: true })
  await view.select({ label: 'Резервный профиль' }, 'profile-1')
  await view.type({ label: 'Идентификатор профиля' }, 'cursor-test', { replace: true })
  await view.press({ text: 'Сохранить настройки' })
  assert.equal(saved.fallback, 'cursor-test'); assert.equal(saved.profiles[3].effort, null)
  assert.equal(saved.profiles[3].model, 'synthetic-high')
  await view.select({ label: 'Редактируемый профиль' }, '3'); await view.press({ text: 'Удалить профиль' })
  await view.press({ text: 'Сохранить настройки' })
  assert.equal(saved.profiles.length, 3); assert.equal(saved.fallback, 'routine')
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('form rejects excessive budgets before saving and backend rejects an injected model', async () => {
  let saves = 0
  const host = mockHost({ requests: { 'fairway.status': () => status(), 'fairway.config': ({ config }) => { saves++; validateConfig(JSON.parse(config)); return status() } } })
  const view = await mount(panel, { host }); await view.select({ label: 'Раздел' }, 'settings')
  for (const text of ['11', '-1', 'NaN', '0.0000001']) {
    await view.type({ label: 'Общий бюджет JEV, USD' }, text, { replace: true }); await view.press({ text: 'Сохранить настройки' })
  }
  assert.equal(saves, 0)
  await view.type({ label: 'Общий бюджет JEV, USD' }, '0.1', { replace: true })
  await view.type({ label: 'Модель профиля' }, 'synthetic; touch /tmp/no', { replace: true })
  await view.press({ text: 'Сохранить настройки' })
  assert.equal(saves, 1); assert.ok(view.find({ text: 'Укажите точный идентификатор модели без пробелов и команд.' }))
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('changing the Pi model or effort clears operator confirmation', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'fairway.status': () => status() } }) })
  await view.select({ label: 'Раздел' }, 'settings'); await view.select({ label: 'Агент профиля' }, 'pi')
  await view.type({ label: 'Модель профиля' }, 'synthetic/model', { replace: true })
  await view.toggle({ label: 'Я проверил эту пару в Pi' })
  assert.equal(view.valueOf({ label: 'Я проверил эту пару в Pi' }), true)
  await view.select({ label: 'Усилие профиля' }, 'high')
  assert.equal(view.valueOf({ label: 'Я проверил эту пару в Pi' }), false)
  await view.toggle({ label: 'Я проверил эту пару в Pi' })
  await view.type({ label: 'Модель профиля' }, 'synthetic/other-model', { replace: true })
  assert.equal(view.valueOf({ label: 'Я проверил эту пару в Pi' }), false)
  assert.deepEqual(view.errors, []); await view.unmount()
})
test('workflow preparation never launches a coordinator automatically', async () => {
  let prepares = 0, actions = 0, workflow: any = null
  const host = mockHost({ requests: {
    'fairway.status': () => ({ ...status(), workflow }),
    'fairway.workflow.create': () => { prepares++; workflow = { id: 'a'.repeat(36), task: 'Synthetic', workspace: { id: 'synthetic', path: '/synthetic-project', host: 'local' }, artifact: '/synthetic-private/analysis.json', coordinatorTask: 'Synthetic', coordinator: example, analysis: null, approvedHash: null, cancelled: false, runs: {} }; return workflow },
    'fairway.workflow.action': () => { actions++; throw new Error('must not run automatically') }
  } })
  const view = await mount(panel, { host }); await view.select({ label: 'Раздел' }, 'workflow')
  await view.type({ label: 'Задача для координатора' }, 'Synthetic https://example.invalid/docs')
  await view.press({ text: 'Подготовить анализ' })
  assert.equal(prepares, 1); assert.equal(actions, 0)
  assert.equal(view.find({ text: 'Запустить координатора через Orca' })?.props.disabled, true)
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
