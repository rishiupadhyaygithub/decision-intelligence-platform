'use client'

// W6.2 — 4-tab layer view. Drop this in a decision detail page:
//   <LayerTabs sku="SC-001" region="West" analysis={analysisJson} />
// L1 fetches /api/kpi, L2 mounts DriverPanel, L3 mounts ForecastChart,
// L4 renders RecommendationCard from pre-fetched analysis.

import { useEffect, useState } from 'react'
import { KPICard } from '@/components/L1/KPICard'
import { DriverPanel } from '@/components/L2/DriverPanel'
import { ForecastChart } from '@/components/L3/ForecastChart'
import { RecommendationCard, type Analysis } from '@/components/L4/RecommendationCard'

type Kpi = {
  key: string
  label: string
  value: number | null
  unit: 'INR' | 'pct' | 'ratio' | 'count' | 'score'
  fact_id: string | null
  data_health: number | null
  unstable: boolean
  dims: Record<string, unknown>
}

type Layer = 'L1' | 'L2' | 'L3' | 'L4'

const TABS: { key: Layer; label: string; desc: string }[] = [
  { key: 'L1', label: 'What happened', desc: 'Descriptive KPIs' },
  { key: 'L2', label: 'Why did it happen', desc: 'Drivers & anomalies' },
  { key: 'L3', label: 'What will happen', desc: 'Forecast & churn risk' },
  { key: 'L4', label: 'What should we do', desc: 'Recommendation & tradeoffs' },
]

export function LayerTabs({
  sku,
  region,
  analysis,
}: {
  sku: string
  region: string
  analysis: Analysis | null
}) {
  const [active, setActive] = useState<Layer>('L1')
  const [kpis, setKpis] = useState<Kpi[] | null>(null)
  const [kpiErr, setKpiErr] = useState<string | null>(null)

  useEffect(() => {
    if (active !== 'L1' || kpis) return
    fetch(`/api/kpi?limit=12`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ kpis: Kpi[] }>
      })
      .then((d) => setKpis(d.kpis))
      .catch((e: Error) => setKpiErr(e.message))
  }, [active, kpis])

  return (
    <div>
      <nav className="flex flex-wrap gap-2 border-b border-neutral-200 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`rounded-md px-3 py-2 text-left text-sm transition ${
              active === t.key
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {t.key}
            </div>
            <div className="font-medium">{t.label}</div>
            <div className="text-[10px] opacity-70">{t.desc}</div>
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {active === 'L1' ? (
          kpiErr ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              KPI fetch failed: {kpiErr}
            </div>
          ) : !kpis ? (
            <div className="text-sm text-neutral-500">Loading KPIs…</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {kpis.map((k) => (
                <KPICard key={k.key} kpi={k} />
              ))}
            </div>
          )
        ) : null}

        {active === 'L2' ? <DriverPanel sku={sku} region={region} /> : null}
        {active === 'L3' ? <ForecastChart sku={sku} region={region} /> : null}
        {active === 'L4' ? (
          analysis ? (
            <RecommendationCard analysis={analysis} />
          ) : (
            <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
              No analysis yet. Run <code className="font-mono">/api/analyze-decision</code> for this decision.
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}
