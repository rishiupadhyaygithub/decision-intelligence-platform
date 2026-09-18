// scripts/facts/test-health-visibility.mjs
// Proves every metric the pipeline computes can actually clear the retriever's
// data_health gate at its realistic sample size.
//
// Why: retriever.ts filters with .gte('data_health', 0.5), and data_health is a
// PRODUCT of freshness x completeness x confidence — so any single weak factor
// zeroes the metric out of every retrieval, silently. Two ways that bit us:
//
//   1. compute.mjs called scoreHealth(facts) with no registry, so every metric
//      used target_n = 12. A latest-snapshot metric has n = 1 by definition and
//      scored completeness = 0.083.
//   2. conf(n) = 1 - 1/sqrt(n) is exactly 0 at n = 1, zeroing the product.
//
// Combined, inventory_cover_ratio scored 0.000 and margin_pct 0.082 — two core
// L1 metrics that could never reach the reasoner, with nothing logged.
//
// Run: node scripts/facts/test-health-visibility.mjs

import { scoreHealth } from './health.mjs'
import { FACT_REGISTRY, KNOWN_METRICS } from './registry.mjs'

const RETRIEVER_GATE = 0.5 // must match .gte('data_health', 0.5) in retriever.ts

// Realistic (sample_n, confidence) for each metric, matching what compute.mjs
// push()es and what ml/*.py emit. confidence null = derived from conf(n).
const CASES = [
  ['revenue_trend_recent', 12, null],
  ['revenue_anomaly_z', 12, null],
  ['margin_pct', 1, 0.99],
  ['sku_velocity_delta', 4, null],
  ['inventory_cover_ratio', 1, 0.95],
  ['competitor_pressure_pct', 4, null],
  ['demand_forecast_next', 6, 0.8],
  ['churn_risk', 6, 0.7],
  ['signal_sentiment', 5, 0.6],
]

// Mirror of conf() in compute.mjs.
const conf = (n) => Math.min(0.95, Math.round((1 - 1 / Math.sqrt(Math.max(n, 1) + 1)) * 100) / 100)

const now = new Date().toISOString()
const facts = CASES.map(([metric, n, c]) => ({
  metric,
  formula_id: metric,
  sample_n: n,
  confidence: c ?? conf(n),
  computed_at: now,
  unstable: false,
}))

scoreHealth(facts, FACT_REGISTRY)

let pass = 0
let fail = 0
console.log('metric'.padEnd(26) + 'n'.padStart(4) + 'health'.padStart(9) + '   visible')
console.log('-'.repeat(56))
for (const f of facts) {
  const ok = f.data_health >= RETRIEVER_GATE
  console.log(
    f.metric.padEnd(26) +
      String(f.sample_n).padStart(4) +
      String(f.data_health).padStart(9) +
      (ok ? '   ✓' : '   ✗ FILTERED OUT')
  )
  ok ? pass++ : fail++
}

// Drift guard: every computed metric must be registered, or it silently falls
// back to target_n = 12 again.
const unregistered = CASES.map(([m]) => m).filter((m) => !KNOWN_METRICS.includes(m))
console.log('')
if (unregistered.length) {
  console.log(`✗ unregistered metrics (would fall back to target_n=12): ${unregistered.join(', ')}`)
  fail++
} else {
  console.log('✓ every computed metric is present in FACT_REGISTRY')
  pass++
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
