'use client'

// W3.4 — L2 Diagnostic panel.
// Fetches /api/diagnose, renders driver waterfall + anomaly list.
// Every driver row + anomaly links back to fact_ids via lineage drawer.

import { useEffect, useState } from 'react'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'

type Driver = { driver: string; beta: number; contribution_pct: number; fact_ids: string[] }
type Anomaly = {
  week: string
  value: number
  expected: number
  residual: number
  z: number
  kind: 'point' | 'level_shift'
}

type DiagnoseResponse = {
  target: { sku: string; region: string; metric: string; n_weeks: number; fact_ids: string[] }
  decomposition: {
    target: string
    n_weeks: number
    r_squared: number
    residual_sigma: number
    drivers: Driver[]
  }
  anomalies: Anomaly[]
  note: string
}

export function DriverPanel({ sku, region }: { sku: string; region: string }) {
  const [data, setData] = useState<DiagnoseResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [openFactId, setOpenFactId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setErr(null)
    fetch('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku, region }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DiagnoseResponse>
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [sku, region])

  if (err) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        Diagnose failed: {err}
      </div>
    )
  }
  if (!data) return <div className="text-sm text-neutral-500">Loading diagnostics…</div>

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-neutral-800">
            Why did {data.target.metric} change? — {sku} · {region}
          </h3>
          <span
            className="text-xs text-neutral-500"
            title={`Ridge R² over ${data.decomposition.n_weeks} weeks`}
          >
            R² = {data.decomposition.r_squared} · σ_resid = {data.decomposition.residual_sigma}
          </span>
        </div>

        {data.decomposition.drivers.length === 0 ? (
          <div className="mt-4 text-sm text-neutral-500">
            Not enough overlapping weeks to attribute drivers yet.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {data.decomposition.drivers.map((d) => (
              <li key={d.driver} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-neutral-800">{d.driver}</span>
                  <span className="tabular-nums text-neutral-700">
                    {d.contribution_pct.toFixed(1)}%
                    <span className="ml-2 text-xs text-neutral-500">β={d.beta}</span>
                  </span>
                </div>
                <div className="h-2 w-full rounded bg-neutral-100">
                  <div
                    className={`h-full rounded ${d.beta >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    style={{ width: `${Math.min(100, d.contribution_pct)}%` }}
                  />
                </div>
                {d.fact_ids.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {d.fact_ids.map((fid) => (
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
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-[11px] italic leading-snug text-neutral-500">{data.note}</p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-800">Anomalies</h3>
        {data.anomalies.length === 0 ? (
          <div className="mt-2 text-sm text-neutral-500">No anomalies flagged.</div>
        ) : (
          <table className="mt-3 w-full text-xs">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1">Week</th>
                <th className="py-1">Kind</th>
                <th className="py-1 text-right">Actual</th>
                <th className="py-1 text-right">Expected</th>
                <th className="py-1 text-right">z</th>
              </tr>
            </thead>
            <tbody className="text-neutral-800">
              {data.anomalies.map((a, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1 font-mono">{a.week}</td>
                  <td className="py-1">{a.kind}</td>
                  <td className="py-1 text-right tabular-nums">{a.value}</td>
                  <td className="py-1 text-right tabular-nums text-neutral-500">{a.expected}</td>
                  <td
                    className={`py-1 text-right tabular-nums ${
                      Math.abs(a.z) >= 3 ? 'text-rose-700' : 'text-amber-700'
                    }`}
                  >
                    {a.z}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openFactId ? (
        <LineageDrawer factId={openFactId} onClose={() => setOpenFactId(null)} />
      ) : null}
    </div>
  )
}
