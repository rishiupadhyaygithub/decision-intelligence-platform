'use client'

// W4.4 — L3 Predictive panel.
// Actuals line + P10/P50/P90 band. Churn score chip on the right.
// Model params + cited fact_ids visible so nothing is a black box.

import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'

type ForecastPoint = { week: string; p10: number; p50: number; p90: number }
type ForecastResp = {
  target: { sku: string; region: string; metric: string; n_history: number }
  history: { week: string; value: number }[]
  forecast: {
    method: string
    horizon: number
    residual_sigma: number
    cv: number
    point: ForecastPoint[]
    alpha: number
    beta: number
    phi: number
    n_train: number
  }
  input_fact_ids: string[]
  note: string
}

type ChurnResp = {
  churn: {
    risk_score: number
    band: 'low' | 'medium' | 'high'
    reasons: string[]
    method: string
  }
  cited_fact_ids: string[]
}

type Merged = {
  week: string
  actual: number | null
  p50: number | null
  band_low: number | null
  band_width: number | null
}

function bandColor(risk: number): string {
  if (risk >= 0.66) return 'bg-rose-100 text-rose-800'
  if (risk >= 0.33) return 'bg-amber-100 text-amber-800'
  return 'bg-emerald-100 text-emerald-800'
}

export function ForecastChart({
  sku,
  region,
  horizon = 4,
}: {
  sku: string
  region: string
  horizon?: number
}) {
  const [fc, setFc] = useState<ForecastResp | null>(null)
  const [ch, setCh] = useState<ChurnResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [openFactId, setOpenFactId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFc(null)
    setCh(null)
    setErr(null)
    Promise.all([
      fetch('/api/forecast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, region, horizon }),
      }).then((r) => r.json() as Promise<ForecastResp>),
      fetch('/api/churn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, region }),
      }).then((r) => r.json() as Promise<ChurnResp>),
    ])
      .then(([f, c]) => {
        if (cancelled) return
        setFc(f)
        setCh(c)
      })
      .catch((e: Error) => !cancelled && setErr(e.message))
    return () => {
      cancelled = true
    }
  }, [sku, region, horizon])

  if (err) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        Forecast failed: {err}
      </div>
    )
  }
  if (!fc || !ch) return <div className="text-sm text-neutral-500">Running forecast…</div>

  const rows: Merged[] = [
    ...fc.history.map((h) => ({
      week: h.week,
      actual: h.value,
      p50: null,
      band_low: null,
      band_width: null,
    })),
    ...fc.forecast.point.map((p) => ({
      week: p.week,
      actual: null,
      p50: p.p50,
      band_low: p.p10,
      band_width: Math.max(0, p.p90 - p.p10),
    })),
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-neutral-800">
            Forecast — {sku} · {region} · next {fc.forecast.horizon} wks
          </h3>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${bandColor(ch.churn.risk_score)}`}
            title={`Churn: ${ch.churn.band} (${ch.churn.reasons.join('; ')})`}
          >
            churn {(ch.churn.risk_score * 100).toFixed(0)}%
          </span>
        </div>

        <div className="mt-3 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="week" fontSize={10} tick={{ fill: '#666' }} />
              <YAxis fontSize={10} tick={{ fill: '#666' }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Area
                dataKey="band_low"
                stackId="band"
                stroke="none"
                fill="transparent"
                legendType="none"
                name="p10"
              />
              <Area
                dataKey="band_width"
                stackId="band"
                stroke="#94a3b8"
                fill="#cbd5e1"
                fillOpacity={0.4}
                name="p10–p90 band"
              />
              <Line dataKey="actual" stroke="#0f172a" strokeWidth={2} dot={false} name="actual" />
              <Line dataKey="p50" stroke="#2563eb" strokeDasharray="4 3" dot={false} name="p50 forecast" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-neutral-600 sm:grid-cols-4">
          <Stat label="method" value={fc.forecast.method} />
          <Stat label="n_train" value={fc.forecast.n_train} />
          <Stat label="cv" value={fc.forecast.cv} />
          <Stat label="σ_resid" value={fc.forecast.residual_sigma} />
        </div>

        <div className="mt-3 text-[11px] text-neutral-500">
          α={fc.forecast.alpha} · β={fc.forecast.beta} · φ={fc.forecast.phi}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {fc.input_fact_ids.slice(0, 8).map((fid) => (
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

        <p className="mt-3 text-[11px] italic leading-snug text-neutral-500">{fc.note}</p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-semibold text-neutral-800">Churn drivers</h4>
          <span className="text-xs text-neutral-500">{ch.churn.method}</span>
        </div>
        <ul className="mt-2 space-y-1 text-neutral-700">
          {ch.churn.reasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-1">
          {ch.cited_fact_ids.map((fid) => (
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
      </div>

      {openFactId ? (
        <LineageDrawer factId={openFactId} onClose={() => setOpenFactId(null)} />
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="tabular-nums text-neutral-800">{value}</div>
    </div>
  )
}
