// W5.2 — Strict grounding gate.
// Existing agents/validator.ts checks citations exist. This layer adds:
//   (a) data_health floor — cited facts must clear a threshold
//   (b) freshness floor — cited facts must be within window
//   (c) unstable-fact gate — reject if a critical cited fact is flagged unstable
//   (d) minimum coverage — must cite >= N distinct facts

import type { Fact } from '@/lib/types'

export interface StrictGroundingOptions {
  min_data_health: number       // 0..1
  max_age_hours: number
  min_distinct_facts: number
  allow_unstable: boolean
}

export const DEFAULT_STRICT: StrictGroundingOptions = {
  min_data_health: 0.5,
  max_age_hours: 168 * 2,      // 2 weeks
  min_distinct_facts: 2,
  allow_unstable: false,
}

export interface StrictGroundingResult {
  passed: boolean
  reasons: string[]
  cited_health: number          // mean data_health of cited facts
  n_cited: number
  n_stale: number
  n_unstable: number
  n_low_health: number
}

type Extended = Fact & {
  data_health?: number | null
  unstable?: boolean | null
  computed_at?: string
}

export function checkStrict(
  usedFacts: Extended[],
  opts: StrictGroundingOptions = DEFAULT_STRICT,
): StrictGroundingResult {
  const reasons: string[] = []
  const now = Date.now()

  const nCited = usedFacts.length
  let nStale = 0
  let nUnstable = 0
  let nLow = 0
  let healthSum = 0
  let healthN = 0

  for (const f of usedFacts) {
    if (typeof f.data_health === 'number') {
      healthSum += f.data_health
      healthN += 1
      if (f.data_health < opts.min_data_health) nLow += 1
    }
    if (f.computed_at) {
      const age = (now - new Date(f.computed_at).getTime()) / 3.6e6
      if (age > opts.max_age_hours) nStale += 1
    }
    if (f.unstable) nUnstable += 1
  }

  const meanHealth = healthN ? healthSum / healthN : 0

  if (nCited < opts.min_distinct_facts) {
    reasons.push(`only ${nCited} facts cited; need >= ${opts.min_distinct_facts}`)
  }
  if (nLow > 0) {
    reasons.push(`${nLow} cited facts under health floor ${opts.min_data_health}`)
  }
  if (nStale > 0) {
    reasons.push(`${nStale} cited facts older than ${opts.max_age_hours}h`)
  }
  if (!opts.allow_unstable && nUnstable > 0) {
    reasons.push(`${nUnstable} cited facts flagged unstable`)
  }

  return {
    passed: reasons.length === 0,
    reasons,
    cited_health: Number(meanHealth.toFixed(3)),
    n_cited: nCited,
    n_stale: nStale,
    n_unstable: nUnstable,
    n_low_health: nLow,
  }
}
