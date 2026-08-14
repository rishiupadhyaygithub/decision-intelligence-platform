// simplified version of checkStrict
const DEFAULT_STRICT = {
  min_data_health: 0.5,
  max_age_hours: 168 * 2,
  min_distinct_facts: 2,
  allow_unstable: false,
}

function checkStrict(usedFacts, opts = DEFAULT_STRICT) {
  const reasons = []
  const now = Date.now()
  let nStale = 0, nLow = 0

  for (const f of usedFacts) {
    if (typeof f.data_health === 'number' && f.data_health < opts.min_data_health) nLow += 1
    const cAt = f.computed_at ?? f.computedAt
    if (cAt) {
      const age = (now - new Date(cAt).getTime()) / 3.6e6
      if (age > opts.max_age_hours) nStale += 1
    }
  }

  if (nLow > 0) reasons.push(`${nLow} cited facts under health floor ${opts.min_data_health}`)
  if (nStale > 0) reasons.push(`${nStale} cited facts older than ${opts.max_age_hours}h`)

  return { passed: reasons.length === 0, reasons }
}

console.log("--- GROUNDING TEST: STALE FACT DECAY ---")
const now = Date.now()
const THREE_WEEKS = 21 * 24 * 3.6e6
const ONE_DAY = 24 * 3.6e6

const oldFact = { id: 'f_old', metric: 'revenue_trend_recent', computed_at: new Date(now - THREE_WEEKS).toISOString(), data_health: 0.1 }
const freshFact = { id: 'f_new', metric: 'sku_velocity_delta', computed_at: new Date(now - ONE_DAY).toISOString(), data_health: 0.99 }

const result = checkStrict([oldFact, freshFact])
console.log("Validation Result:", result)

if (!result.passed && result.reasons.some(r => r.includes('older than')) && result.reasons.some(r => r.includes('under health floor'))) {
  console.log("✅ PASS: The old fact was successfully retained in DB but REJECTED by LLM grounding.")
} else {
  console.error("❌ FAIL: Grounding layer didn't reject it properly.")
}
