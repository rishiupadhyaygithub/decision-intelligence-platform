// scripts/facts/test-prune-safety.mjs
// Guards the stale-fact prune rule in compute.mjs.
//
// History: the prune was once a naive "delete every fact not in the new batch".
// That wipes good facts whenever a source view returns empty for one run, so it
// was disabled outright (`const stale = []`). Disabling it is also wrong — the
// facts table then grows forever, and since data_health is a STORED column that
// the retriever filters on (.gte('data_health', 0.5)) and nothing ever
// recomputes, orphaned facts keep grounding answers indefinitely.
//
// The rule below is the middle ground: prune only INSIDE metrics that this batch
// actually produced. These tests pin that behaviour. Keep in sync with the
// `stale` computation in compute.mjs.
//
// Run: node scripts/facts/test-prune-safety.mjs

/** Mirror of the prune rule in compute.mjs. */
function prune(existing, facts) {
  const newIds = new Set(facts.map((f) => f.id))
  const producedMetrics = new Set(facts.map((f) => f.metric))
  return existing
    .filter((r) => producedMetrics.has(r.metric) && !newIds.has(r.id))
    .map((r) => r.id)
}

const EXISTING = [
  { id: 'a1', metric: 'revenue' },
  { id: 'a2', metric: 'revenue' },
  { id: 'b1', metric: 'churn_risk' },
  { id: 'c1', metric: 'inventory_cover_ratio' },
]

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

// Happy path: a metric was recomputed, so its superseded rows go.
check(
  'prunes superseded rows within a recomputed metric',
  prune(EXISTING, [{ id: 'a2', metric: 'revenue' }, { id: 'a3', metric: 'revenue' }]),
  ['a1']
)

// A skipped ML model produces no facts for its metric — those facts must survive.
check(
  'facts of a skipped ML model are never pruned',
  prune(EXISTING, [{ id: 'a2', metric: 'revenue' }]).includes('b1'),
  false
)

// Same for a SQL source that returned empty this run.
check(
  'facts of an empty source metric are never pruned',
  prune(EXISTING, [{ id: 'a2', metric: 'revenue' }]).includes('c1'),
  false
)

// The regression that caused the prune to be disabled in the first place.
check('a totally empty batch prunes NOTHING', prune(EXISTING, []), [])

// Idempotency: recomputing identical facts must not churn the table.
check('an identical rerun is a no-op', prune(EXISTING, EXISTING), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
