// Holdout validation for the in-process forecast (A8): the out-of-sample check must
// exist on long-enough series and must actually beat the naive baseline on a series
// with a real trend. Run: node --test 'tests/unit/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forecast } from '../../src/lib/predict/forecast.ts'

const weeks = (n, f) =>
  Array.from({ length: n }, (_, i) => ({
    week: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10),
    value: f(i),
  }))

test('short history has no holdout', () => {
  assert.equal(forecast(weeks(8, (i) => 100 + i)).holdout, null)
})

test('holdout uses the last quarter of history, capped at 4 weeks', () => {
  assert.equal(forecast(weeks(12, (i) => 100 + i)).holdout.n, 3)
  assert.equal(forecast(weeks(40, (i) => 100 + i)).holdout.n, 4)
})

test('on a trending series the model beats repeating the last value', () => {
  const h = forecast(weeks(24, (i) => 100 + 5 * i)).holdout
  assert.ok(h.mae < h.naive_mae, JSON.stringify(h))
  assert.ok(h.skill > 0)
})

test('forecast still returns the requested horizon with ordered bands', () => {
  const out = forecast(weeks(20, (i) => 100 + 3 * i + (i % 3)), 4)
  assert.equal(out.point.length, 4)
  for (const p of out.point) assert.ok(p.p10 <= p.p50 && p.p50 <= p.p90)
})
