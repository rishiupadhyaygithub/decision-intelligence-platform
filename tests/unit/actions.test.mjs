// The action engine must propose concrete, money-quantified actions only when the
// numbers call for one, and its arithmetic must add up.
// Run: node --test 'tests/unit/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildActions, restockOutcome, promoOutcome, demand, coverPath, ASSUMPTIONS } from '../../src/lib/actions/engine.ts'

const weeks = (n, f) =>
  Array.from({ length: n }, (_, i) => ({ week: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10), units: f(i) }))
const series = (over) => ({
  sku: 'A1',
  name: 'Alpha Chips',
  region: 'West',
  weeks: weeks(26, () => 1000),
  unitPrice: 90,
  unitCost: 60,
  onHand: 4000,
  reorderPoint: 2000,
  stockAsOf: '2026-10-31',
  ...over,
})

test('steady demand is forecast close to its level', () => {
  const d = demand(series())
  assert.ok(Math.abs(d.weekly - 1000) < 50, `weekly ${d.weekly}`)
  assert.ok(d.confidence >= 0.35 && d.confidence <= 0.95)
})

test('healthy stock produces no action', () => {
  assert.equal(buildActions([series({ onHand: 4000 })]).length, 0)
})

test('short stock produces a restock up to target cover, in whole cases', () => {
  const [a] = buildActions([series({ onHand: 900 })])
  assert.equal(a.type, 'restock')
  assert.equal(a.urgency, 'now') // under one week of cover
  assert.equal(a.quantity % ASSUMPTIONS.caseSize, 0)
  assert.ok(Math.abs(a.quantity - (4000 - 900)) <= ASSUMPTIONS.caseSize + 60, `qty ${a.quantity}`)
  assert.ok(a.impact.revenue > 0 && a.impact.value > 0)
  assert.match(a.title, /^Order [\d,]+ units of Alpha Chips for West$/)
})

test('restock arithmetic: demand during lead time beyond stock is lost either way', () => {
  const s = series({ onHand: 500 })
  const r = restockOutcome(s, 1000, 3500)
  // horizon 4w: lost without = 4000-500 = 3500; lost during the 1-week lead = 500
  assert.equal(r.protectedUnits, 3000)
  assert.equal(r.revenue, 3000 * 90)
  assert.equal(r.margin, 3000 * 30)
  assert.equal(restockOutcome(s, 1000, 0).protectedUnits, 0)
})

test('a long sister region supplies a transfer before any new order', () => {
  const actions = buildActions([series({ region: 'West', onHand: 900 }), series({ region: 'North', onHand: 12000 })])
  const t = actions.find((a) => a.type === 'transfer')
  assert.ok(t, JSON.stringify(actions.map((a) => a.type)))
  assert.equal(t.fromRegion, 'North')
  assert.equal(t.region, 'West')
  assert.ok(!actions.some((a) => a.type === 'restock' && a.region === 'West' && a.quantity > t.quantity))
})

test('overstock produces a promotion that frees cash; its margin effect is reported, not hidden', () => {
  const [a] = buildActions([series({ onHand: 9000 })])
  assert.equal(a.type, 'promote')
  assert.equal(a.discount, ASSUMPTIONS.promoDiscount)
  const p = promoOutcome(series({ onHand: 9000 }), 1000, 0.1)
  assert.ok(p.cashFreed > 0 && p.extraUnits <= 9000 - 4000)
  assert.ok(a.evidence.some((e) => e.label.includes('Margin effect')))
})

test('actions are ordered by urgency, then by revenue at stake', () => {
  const actions = buildActions([series({ sku: 'B', name: 'B', onHand: 1500 }), series({ sku: 'C', name: 'C', onHand: 600 })])
  assert.deepEqual(actions.map((a) => a.urgency), ['now', 'this week'])
})

test('cover path: an arrival lifts the "with" line only', () => {
  const p = coverPath(1000, 500, { week: 1, units: 2000 }, 4)
  assert.equal(p[0].with, 1000)
  assert.equal(p[2].without, 0)
  assert.ok(p[2].with > p[2].without)
})

test('the same data always gives the same quantities (no random forecast noise)', () => {
  const s = series({ onHand: 900, weeks: weeks(26, (i) => 1000 + ((i * 37) % 90)) })
  const q = [1, 2, 3, 4].map(() => buildActions([s])[0].quantity)
  assert.equal(new Set(q).size, 1, q.join(','))
})
