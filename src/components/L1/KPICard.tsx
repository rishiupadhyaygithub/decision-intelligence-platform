'use client'

// W2.2 — KPI card.
// Every displayed number carries a fact_id + data_health chip.
// Click the value to open the Lineage Drawer.

import { useState } from 'react'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'

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

function formatValue(v: number | null, unit: Kpi['unit']): string {
  if (v == null) return '—'
  switch (unit) {
    case 'INR':
      return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v)}`
    case 'pct':
      return `${v.toFixed(1)}%`
    case 'ratio':
      return v.toFixed(2)
    case 'score':
      return v.toFixed(2)
    default:
      return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(v)
  }
}

function healthColor(h: number | null): string {
  if (h == null) return 'bg-neutral-200 text-neutral-600'
  if (h >= 0.75) return 'bg-emerald-100 text-emerald-800'
  if (h >= 0.5) return 'bg-amber-100 text-amber-800'
  return 'bg-rose-100 text-rose-800'
}

function dimsLabel(dims: Record<string, unknown>): string {
  const parts = Object.entries(dims)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
  return parts.join(' · ')
}

export function KPICard({ kpi }: { kpi: Kpi }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium text-neutral-700">{kpi.label}</div>
          {kpi.unstable ? (
            <span
              className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800"
              title="Outlier guard tripped"
            >
              unstable
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => kpi.fact_id && setOpen(true)}
          disabled={!kpi.fact_id}
          className="mt-2 text-left text-3xl font-semibold text-neutral-900 tabular-nums hover:underline disabled:cursor-not-allowed disabled:no-underline"
          title={kpi.fact_id ? `fact_id: ${kpi.fact_id}` : ''}
        >
          {formatValue(kpi.value, kpi.unit)}
        </button>

        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span className="truncate">{dimsLabel(kpi.dims) || '—'}</span>
          <span
            className={`rounded px-2 py-0.5 font-medium ${healthColor(kpi.data_health)}`}
            title="Data health = freshness × completeness × source confidence"
          >
            health {kpi.data_health != null ? kpi.data_health.toFixed(2) : '—'}
          </span>
        </div>
      </div>

      {open && kpi.fact_id ? (
        <LineageDrawer factId={kpi.fact_id} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}
