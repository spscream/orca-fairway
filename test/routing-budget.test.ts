import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routingBudget, routingFailure, storedRoutingFailure } from '../src/core/routing-budget.ts'
import { DEFAULT_CONFIG } from '../src/core/config.ts'
import type { Workflow } from '../src/core/workflow.ts'
const workflow = { analysis: { steps: ['one', 'two', 'three', 'four', 'five'].map(id => ({ id })) }, runs: { one: { state: 'completed' }, two: { state: 'completed' }, three: { state: 'planned', plan: { reason: 'budget_exhausted' } } } } as unknown as Workflow
test('shared conservative allowance shows why five used decisions cannot route three remaining steps', () => {
  const config = { ...DEFAULT_CONFIG, live: true }, ledger = { calls: 5, reservedMicrousd: 65540 }
  assert.deepEqual(routingBudget(config, ledger, workflow), { needed: 3, affordable: 0, sufficient: false })
  assert.deepEqual(routingBudget({ ...config, maxCalls: 10 }, ledger, workflow), { needed: 3, affordable: 2, sufficient: false })
  assert.deepEqual(routingBudget({ ...config, maxCalls: 10, budgetMicrousd: 150000 }, ledger, workflow), { needed: 3, affordable: 5, sufficient: true })
  assert.equal(routingBudget({ ...config, maxCalls: 8, budgetMicrousd: 104864 }, ledger, workflow).sufficient, true)
  assert.equal(routingBudget({ ...config, maxCalls: 8, budgetMicrousd: 104863 }, ledger, workflow).sufficient, false)
  assert.equal(routingBudget({ ...config, live: false }, ledger, workflow).sufficient, true)
})
test('stored routing failures distinguish budget, key, timeout, low confidence and invalid choices without raw messages', () => {
  assert.equal(storedRoutingFailure(workflow), 'budget_exhausted')
  for (const [code, reason] of Object.entries({ missing_key: 'missing_key', timeout: 'routing_timeout', low_confidence_fallback: 'low_confidence', invalid_choice: 'invalid_choice', pricing_unbounded: 'pricing_unbounded', http_error: 'http_error', 'private-error-marker': 'routing_failed' })) assert.equal(routingFailure(code), reason)
})
test('explicit unlimited mode has no aggregate allowance while retaining needed-step counts', () => {
  const budget = routingBudget({ ...DEFAULT_CONFIG, live: true, unlimitedJev: true, maxCalls: 0, budgetMicrousd: 0 }, { calls: 500, reservedMicrousd: 6554000 }, workflow)
  assert.deepEqual(budget, { needed: 3, affordable: null, sufficient: true })
})
