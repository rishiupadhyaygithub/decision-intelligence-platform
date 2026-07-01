// W5.3 — Tradeoff structurer.
// LLM returns alternatives as free text; this shapes them into
// { action, upside, downside, expected_impact_pct, cited_fact_ids }.
// If LLM output is thin, we synthesize a "hold" baseline from L2/L3 facts
// so the UI always has >= 2 options to compare.

import type { Fact } from '@/lib/types'

export interface TradeoffOption {
  key: 'recommended' | 'alt' | 'hold'
  action: string
  upside: string
  downside: string
  expected_impact_pct: number | null
  cited_fact_ids: string[]
}

interface LlmAlt {
  option?: string
  action?: string
  upside?: string
  downside?: string
  factId?: string
  fact_id?: string
  expected_impact?: string | number
}

interface LlmReason {
  recommendation?: string
  alternatives?: LlmAlt[] | string[]
  summary?: string
}

const pct = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? Number(n.toFixed(1)) : null
}

const factIdsFor = (text: string, facts: Fact[]): string[] => {
  const ids = new Set<string>()
  for (const f of facts) if (text.includes(f.id)) ids.add(f.id)
  return Array.from(ids)
}

export function shapeTradeoffs(
  reason: LlmReason,
  usedFacts: Fact[],
  forecastP50Delta?: number | null,
): TradeoffOption[] {
  const options: TradeoffOption[] = []

  if (reason.recommendation) {
    options.push({
      key: 'recommended',
      action: reason.recommendation.trim(),
      upside: reason.summary ?? '',
      downside: '',
      expected_impact_pct: forecastP50Delta ?? null,
      cited_fact_ids: factIdsFor(reason.recommendation, usedFacts),
    })
  }

  const alts = Array.isArray(reason.alternatives) ? reason.alternatives : []
  for (const a of alts) {
    if (typeof a === 'string') {
      options.push({
        key: 'alt',
        action: a,
        upside: '',
        downside: '',
        expected_impact_pct: null,
        cited_fact_ids: factIdsFor(a, usedFacts),
      })
    } else if (a && typeof a === 'object') {
      const text = a.action ?? a.option ?? ''
      options.push({
        key: 'alt',
        action: text,
        upside: a.upside ?? '',
        downside: a.downside ?? '',
        expected_impact_pct: pct(a.expected_impact),
        cited_fact_ids: factIdsFor(`${text} ${a.factId ?? a.fact_id ?? ''}`, usedFacts),
      })
    }
  }

  // Guarantee a comparator: synthetic "hold and monitor" if we're bare.
  if (options.length < 2) {
    options.push({
      key: 'hold',
      action: 'Hold current course; monitor next 2 weeks',
      upside: 'Preserves margin, avoids commitment while signals firm up',
      downside: 'Cedes response window if competitor pressure sustains',
      expected_impact_pct: forecastP50Delta != null ? Number((-forecastP50Delta * 0.5).toFixed(1)) : null,
      cited_fact_ids: usedFacts.slice(0, 2).map((f) => f.id),
    })
  }

  return options.slice(0, 4)
}
