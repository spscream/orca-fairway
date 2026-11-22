import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { DEFAULT_CONFIG } from './core/config.ts'
import type { Plan } from './core/types.ts'
import type { Status } from './protocol.ts'
const example: Plan = { id: 'a'.repeat(36), profile: DEFAULT_CONFIG.profiles[0]!, reason: 'offline', confidence: null, createdAt: 1, expiresAt: 9999999999999, configHash: '', taskHash: '', workspaceHash: '', evidence: { verified: true, source: 'synthetic_metadata' }, costUsd: null, reservedMicrousd: 0, state: 'shadow', observedModel: null, observedEffort: null }
function status(execution = false): Status { return { config: { ...DEFAULT_CONFIG, execution }, ledger: { calls: 0, reservedMicrousd: 0 }, keyPresent: false, workspace: 'synthetic', lastPlan: null, bridgePath: null } }
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
