'use client'

// The numbered evidence a decision rests on. Numbers match the markers in the text
// (CitedText). Each row opens the full lineage: formula, source rows, freshness.

import { useState } from 'react'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'
import { metricLabel, windowLabel } from '@/lib/labels'

export interface EvidenceItem {
  fact_id: string | null
  metric: string | null
  value: number | string | null
  window: string | null
  live: boolean
  drifted_to: number | string | null
  uses: number
}

const fmt = (v: number | string | null) => {
  if (v == null) return '—'
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)
}

export default function EvidenceList({ items }: { items: EvidenceItem[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <ol className="divide-y divide-line">
        {items.map((e, i) => (
          <li key={e.fact_id ?? i}>
            <button
              type="button"
              disabled={!e.fact_id}
              onClick={() => e.fact_id && setOpen(e.fact_id)}
              className="group grid w-full grid-cols-[28px_1fr_auto] items-baseline gap-3 py-3 text-left disabled:cursor-default"
            >
              <span className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-indigo-50 px-1 text-[11px] font-semibold text-indigo-700">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900 group-hover:underline decoration-slate-300 underline-offset-2">
                  {e.metric ? metricLabel(e.metric) : 'Evidence unavailable'}
                </span>
                <span className="block text-xs text-slate-500">
                  {[windowLabel(e.window), e.uses > 1 ? `supports ${e.uses} points` : null, !e.live ? 'archived: recomputed since' : null]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-semibold text-slate-900">{fmt(e.value)}</span>
                {e.drifted_to != null && (
                  <span className="block text-xs text-indigo-700" title="The value has been recomputed since this decision. The bold value is what the decision used.">
                    now {fmt(e.drifted_to)}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {open && <LineageDrawer factId={open} onClose={() => setOpen(null)} />}
    </>
  )
}
