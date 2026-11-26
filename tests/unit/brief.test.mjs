// The brief must rank what needs action first, say it in plain language, and keep
// the fact ids that back every line. Run: node --test 'tests/unit/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBrief, compact } from '../../src/lib/brief.ts'

const f = (id, metric, dims, value) => ({ id, metric, dims, value })
const names = { 'SC-001': 'Classic Chips', 'SR-004': 'Ready Rajma' }

test('below reorder point is an act-now item, escalated when sales are rising', () => {
  const issues = buildBrief(
    [f('i1', 'inventory_cover_ratio', { sku: 'SC-001', region: 'West' }, 0.7), f('v1', 'sku_velocity_delta', { sku: 'SC-001', region: 'West' }, 18)],
    names,
  )
  const stock = issues.find((i) => i.key.startsWith('stock:'))
  assert.equal(stock.tone, 'act')
  assert.match(stock.headline, /Classic Chips in West is below its reorder point/)
  assert.deepEqual(stock.factIds, ['i1', 'v1'])
  assert.match(stock.detail, /up \+18%/)
})

test('healthy numbers produce no noise', () => {
  const issues = buildBrief([
    f('i1', 'inventory_cover_ratio', { sku: 'SC-001', region: 'West' }, 1.8),
    f('v1', 'sku_velocity_delta', { sku: 'SC-001', region: 'West' }, 3),
    f('c1', 'churn_risk', { sku: 'SC-001', region: 'West' }, 0.05),
    f('r1', 'revenue_trend_recent', { region: 'West' }, 2),
    f('p1', 'competitor_pressure_pct', { category: 'Competitor' }, 20),
  ])
  assert.equal(issues.length, 0)
})

test('act items rank above watch items above good news', () => {
  const issues = buildBrief([
    f('r1', 'revenue_trend_recent', { region: 'South' }, 15),
    f('v1', 'sku_velocity_delta', { sku: 'SR-004', region: 'North' }, -12),
    f('i1', 'inventory_cover_ratio', { sku: 'SC-001', region: 'West' }, 0.6),
  ], names)
  assert.deepEqual(issues.map((i) => i.tone), ['act', 'watch', 'good'])
})

test('every issue carries a ready-to-use decision prompt', () => {
  const [i] = buildBrief([f('v1', 'sku_velocity_delta', { sku: 'SR-004', region: 'North' }, -25)], names)
  assert.equal(i.tone, 'act')
  assert.match(i.decide.title, /SR-004 in North/)
  assert.match(i.decide.proposal, /Ready Rajma \(SR-004\)/)
})

test('compact formats figures for axes', () => {
  assert.equal(compact(912), '912')
  assert.equal(compact(8460), '8.5k')
  assert.equal(compact(84500), '85k')
  assert.equal(compact(1234567), '1.2M')
})
