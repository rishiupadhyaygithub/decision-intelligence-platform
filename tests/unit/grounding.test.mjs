// Unit tests for the two grounding gates the L4 answer must pass.
// Runs the TypeScript sources directly via Node's built-in type stripping (Node >= 22.18).
// Run: node --test tests/unit/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, validateFreeText, collectCitedFactIds } from '../../src/lib/agents/validator.ts'
import { checkStrict, DEFAULT_STRICT } from '../../src/lib/grounding/validate.ts'

const now = new Date().toISOString()
const F1 = { id: 'f1', metric: 'inventory_cover_ratio', dims: { sku: 'SC-001', region: 'West' }, value: 0.62, valueText: null, data_health: 0.95, unstable: false, computedAt: now }
const F2 = { id: 'f2', metric: 'sku_velocity_delta', dims: { sku: 'SC-001', region: 'West' }, value: -18.4, valueText: null, data_health: 0.89, unstable: false, computedAt: now }
const FACTS = [F1, F2]

const ev = (f, extra = {}) => ({ fact_id: f.id, metric: f.metric, value: f.value, dims: f.dims, ...extra })
const answer = (over = {}) => ({
  summary: 'Cover is short [f1] while velocity falls [f2].',
  recommendation: 'Expedite restock [f1].',
  claims: [{ text: 'Cover is 0.62 [f1].', type: 'factual', structured_evidence: [ev(F1)] }],
  risks: [{ risk: 'Velocity down [f2].', severity: 'high', type: 'factual', structured_evidence: [ev(F2)] }],
  alternatives: [],
  ...over,
})

test('a fully grounded answer passes', () => {
  const r = validate(answer(), FACTS)
  assert.equal(r.ok, true, JSON.stringify(r.violations))
})

test('citing an id that was never retrieved fails', () => {
  const r = validate(answer({ summary: 'Invented [f999].' }), FACTS)
  assert.equal(r.ok, false)
  assert.ok(r.violations.some((v) => v.token === 'f999'))
})

test('a factual claim with no structured evidence fails', () => {
  const r = validate(answer({ claims: [{ text: 'Cover is low.', type: 'factual', structured_evidence: [] }] }), FACTS)
  assert.equal(r.ok, false)
})

test('a value that does not match the cited fact fails', () => {
  const claims = [{ text: 'Cover is 2.0 [f1].', type: 'factual', structured_evidence: [ev(F1, { value: 2.0 })] }]
  assert.equal(validate(answer({ claims }), FACTS).ok, false)
})

test('a metric that does not match the cited fact fails', () => {
  const claims = [{ text: 'Cover [f1].', type: 'factual', structured_evidence: [ev(F1, { metric: 'margin_pct' })] }]
  assert.equal(validate(answer({ claims }), FACTS).ok, false)
})

test('evidence for the wrong region fails (dimension check is live)', () => {
  const claims = [{ text: 'Cover [f1].', type: 'factual', structured_evidence: [ev(F1, { dims: { sku: 'SC-001', region: 'East' } })] }]
  const r = validate(answer({ claims }), FACTS)
  assert.equal(r.ok, false)
  assert.ok(r.violations.some((v) => v.reason.includes('Dimension')))
})

test('prose citation missing from structured evidence fails', () => {
  const claims = [{ text: 'Cover [f1] and velocity [f2].', type: 'factual', structured_evidence: [ev(F1)] }]
  assert.equal(validate(answer({ claims }), FACTS).ok, false)
})

test('an inference with no evidence is allowed', () => {
  const claims = [{ text: 'Demand may recover.', type: 'inference', structured_evidence: [] }]
  assert.equal(validate(answer({ claims }), FACTS).ok, true)
})

test('collectCitedFactIds gathers prose and evidence ids', () => {
  assert.deepEqual([...collectCitedFactIds(answer(), FACTS)].sort(), ['f1', 'f2'])
})

test('validateFreeText rejects unknown ids', () => {
  assert.equal(validateFreeText('see [f1]', FACTS).ok, true)
  assert.equal(validateFreeText('see [nope]', FACTS).ok, false)
})

test('strict gate: two fresh healthy stable facts pass', () => {
  const r = checkStrict(FACTS, DEFAULT_STRICT)
  assert.equal(r.passed, true, r.reasons.join('; '))
  assert.equal(r.n_cited, 2)
})

test('strict gate: one cited fact is below minimum coverage', () => {
  assert.equal(checkStrict([F1]).passed, false)
})

test('strict gate: low health, stale and unstable facts are each rejected', () => {
  const old = new Date(Date.now() - 400 * 3.6e6).toISOString()
  assert.equal(checkStrict([F1, { ...F2, data_health: 0.2 }]).n_low_health, 1)
  assert.equal(checkStrict([F1, { ...F2, computedAt: old }]).n_stale, 1)
  const u = checkStrict([F1, { ...F2, unstable: true }])
  assert.equal(u.passed, false)
  assert.equal(u.n_unstable, 1)
})
