'use client'

// W5.5 — L4 Prescriptive card.
// Shows recommended action + tradeoff options + confidence breakdown.
// Every option's cited fact_ids open the Lineage Drawer.

import { useState } from 'react'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'

type Option = {
  key: 'recommended' | 'alt' | 'hold'
  action: string
  upside: string
  downside: string
  expected_impact_pct: number | null
  cited_fact_ids: string[]
}

type Confidence = {
  score: number
  band: 'low' | 'medium' | 'high'
  components: {
    data_health: number
    forecast_certainty: number
    driver_clarity: number
    coverage_penalty: number
  }
}

type StrictGrounding = {
  passed: boolean
  reasons: string[]
  cited_health: number
  n_cited: number
  n_stale: number
  n_unstable: number
  n_low_health: number
}

export type Analysis = {
  summary: string
  recommendation: string
  options: Option[]
  confidence_composite: Confidence
  strict_grounding: StrictGrounding
  grounded: boolean
  facts_used: { id: string; metric: string; value: string | number | null; window: string | null }[]
  skeptic: { disagrees: boolean; refutation: string } | null
}

function bandColor(band: Confidence['band']) {
  if (band === 'high') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (band === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-rose-100 text-rose-800 border-rose-200'
}

function optionBorder(key: Option['key']) {
  if (key === 'recommended') return 'border-emerald-400 bg-emerald-50'
  if (key === 'hold') return 'border-neutral-300 bg-neutral-50'
  return 'border-neutral-200 bg-white'
}

export function RecommendationCard({ analysis }: { analysis: Analysis }) {
  const [openFactId, setOpenFactId] = useState<string | null>(null)
  const c = analysis.confidence_composite
  const s = analysis.strict_grounding

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Recommendation
            </div>
            <p className="mt-1 text-base font-semibold text-neutral-900">
              {analysis.recommendation}
            </p>
          </div>
          <div className={`rounded-md border px-3 py-2 text-right ${bandColor(c.band)}`}>
            <div className="text-[10px] uppercase tracking-wide">confidence</div>
            <div className="tabular-nums text-lg font-bold">{c.score}</div>
            <div className="text-[10px] uppercase">{c.band}</div>
          </div>
        </div>

        {analysis.summary ? (
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">{analysis.summary}</p>
        ) : null}

        {!s.passed ? (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">Grounding gate: soft-fail</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {s.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Cmp label="data health" v={c.components.data_health} />
          <Cmp label="forecast certainty" v={c.components.forecast_certainty} />
          <Cmp label="driver clarity" v={c.components.driver_clarity} />
          <Cmp label="coverage" v={c.components.coverage_penalty} />
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-neutral-800">Tradeoffs</h4>
        <div className="mt-3 space-y-2">
          {analysis.options.map((o, i) => (
            <div key={i} className={`rounded-md border p-3 ${optionBorder(o.key)}`}>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium text-neutral-900">{o.action}</div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  {o.expected_impact_pct != null ? (
                    <span
                      className={`tabular-nums ${
                        o.expected_impact_pct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {o.expected_impact_pct >= 0 ? '+' : ''}
                      {o.expected_impact_pct}% expected
                    </span>
                  ) : null}
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                    {o.key}
                  </span>
                </div>
              </div>
              {o.upside ? (
                <div className="mt-1 text-xs text-emerald-700">↑ {o.upside}</div>
              ) : null}
              {o.downside ? (
                <div className="text-xs text-rose-700">↓ {o.downside}</div>
              ) : null}
              {o.cited_fact_ids.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {o.cited_fact_ids.map((fid) => (
                    <button
                      key={fid}
                      type="button"
                      onClick={() => setOpenFactId(fid)}
                      className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-[10px] text-neutral-700 hover:bg-neutral-200"
                    >
                      {fid}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {analysis.skeptic ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-neutral-800">Adversarial check</h4>
          <div className="mt-1 text-xs text-neutral-500">
            {analysis.skeptic.disagrees ? 'Skeptic disagrees' : 'Skeptic concurs'}
          </div>
          <p className="mt-2 text-sm text-neutral-700">{analysis.skeptic.refutation}</p>
        </div>
      ) : null}

      {openFactId ? (
        <LineageDrawer factId={openFactId} onClose={() => setOpenFactId(null)} />
      ) : null}
    </div>
  )
}

function Cmp({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="tabular-nums text-neutral-800">{v.toFixed(2)}</div>
    </div>
  )
}
