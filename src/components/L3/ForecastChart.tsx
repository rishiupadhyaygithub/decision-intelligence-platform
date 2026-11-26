'use client'

// W4.4 — L3 Predictive panel.
// Actuals line + P10/P50/P90 band. Churn score chip on the right.
// Model params + cited fact_ids visible so nothing is a black box.

import { Skeleton } from '@/components/decisionos'
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
    holdout: { n: number; mae: number; naive_mae: number; skill: number } | null
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
  ml_churn: { risk_score: number; predicts: string; method: string; fact_id: string } | null
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
        setErr(null)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setFc(null)
          setCh(null)
          setErr(e.message)
        }
      })
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
  if (!fc || !ch) return <Skeleton rows={2} label="Running forecast" />

  // Last 26 weeks of history is enough context; older weeks only flatten the chart.
  const recent = fc.history.slice(-26)
  const rows: Merged[] = [
    ...recent.map((h) => ({
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
  const next = fc.forecast.point[0]
  const fmtWeek = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const n = (v: number) => Math.round(v).toLocaleString()
  const h = fc.forecast.holdout
  const dip = ch.ml_churn?.risk_score ?? ch.churn.risk_score

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Next {fc.forecast.horizon} weeks for {sku} in {region}
            </h3>
            {next ? (
              <p className="mt-1 text-sm text-slate-600">
                Next week: about <span className="font-semibold text-slate-900">{n(next.p50)}</span> units, likely between{' '}
                {n(next.p10)} and {n(next.p90)}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">{fc.note}</p>
            )}
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${bandColor(dip)}`}
            title={ch.churn.reasons.join('; ')}
          >
            {(dip * 100).toFixed(0)}% chance of a sales dip
          </span>
        </div>

        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#edf0ee" />
              <XAxis dataKey="week" tickFormatter={fmtWeek} tick={{ fontSize: 11, fill: '#637079' }} axisLine={false} tickLine={false} minTickGap={32} />
              <YAxis tick={{ fontSize: 11, fill: '#637079' }} axisLine={false} tickLine={false} width={44} domain={[(min: number) => Math.floor(min * 0.85), (max: number) => Math.ceil(max * 1.08)]} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: '1px solid #dde2df', fontSize: 12 }}
                labelFormatter={(w) => `Week of ${fmtWeek(String(w))}`}
                formatter={(v, name) => (name === 'Likely range' ? [null, null] : [n(Number(v)), name])}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band_low" stackId="band" stroke="none" fill="transparent" legendType="none" name="low" />
              <Area dataKey="band_width" stackId="band" stroke="none" fill="#0f7b5f" fillOpacity={0.14} name="Likely range" />
              <Line dataKey="actual" stroke="#12212e" strokeWidth={2} dot={false} name="Actual units" />
              <Line dataKey="p50" stroke="#0f7b5f" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Forecast" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <Stat label="Learned from" value={`${fc.forecast.n_train} weeks of sales`} />
          <Stat label="Typical miss" value={`about ±${n(fc.forecast.residual_sigma)} units a week`} />
          {h ? (
            <Stat
              label={`Tested on the last ${h.n} weeks`}
              value={h.skill > 0.02 ? `${(h.skill * 100).toFixed(0)}% more accurate than a naive guess` : 'no better than repeating last week: treat as rough'}
            />
          ) : (
            <Stat label="Accuracy check" value="needs 10+ weeks of history" />
          )}
        </dl>
        {fc.input_fact_ids.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Based on{' '}
            {fc.input_fact_ids.slice(0, 4).map((fid, i) => (
              <button key={fid} type="button" onClick={() => setOpenFactId(fid)} className="mr-1 font-medium text-indigo-700 underline decoration-indigo-200 underline-offset-2">
                evidence {i + 1}
              </button>
            ))}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-line bg-white p-5 text-sm">
        <h4 className="text-base font-semibold text-slate-900">Why a dip could happen</h4>
        <ul className="mt-2 space-y-1 text-slate-700">
          {ch.churn.reasons.map((r, i) => (
            <li key={i}>{r === 'no dominant signal' ? 'No single warning sign stands out.' : r[0].toUpperCase() + r.slice(1) + '.'}</li>
          ))}
        </ul>
        {ch.ml_churn ? (
          <p className="mt-2 text-slate-600">
            The trend model gives a <span className="font-semibold">{(ch.ml_churn.risk_score * 100).toFixed(0)}%</span> chance that next week&apos;s
            units fall more than 15% below the recent average.
          </p>
        ) : null}
        {ch.cited_fact_ids.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Based on{' '}
            {ch.cited_fact_ids.map((fid, i) => (
              <button key={fid} type="button" onClick={() => setOpenFactId(fid)} className="mr-1 font-medium text-indigo-700 underline decoration-indigo-200 underline-offset-2">
                evidence {i + 1}
              </button>
            ))}
          </p>
        )}
      </div>

      {openFactId ? <LineageDrawer factId={openFactId} onClose={() => setOpenFactId(null)} /> : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  )
}
