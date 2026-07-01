'use client'

// W6.1 stub — Lineage Drawer.
// Fetches /api/lineage/[factId] and shows fact row + formula spec + source rows.
// Rendered on-demand by KPICard and (later) L2/L3/L4 panels.

import { useEffect, useState } from 'react'

type LineageResponse = {
  fact: {
    id: string
    metric: string
    dims: Record<string, unknown>
    value: number | null
    method: string
    sample_n: number | null
    confidence: number | null
    data_health: number | null
    unstable: boolean | null
    formula_id: string | null
    time_window: string | null
    computed_at: string
    source_rows: Array<{ table: string; pk: string | number }>
  }
  formula: {
    id: string
    layer: string
    kind: string
    unit: string
    description: string
    formula: string
    inputs: string[]
    freshness_window_hrs: number
    owner: string
  } | null
  source_rows: Array<{ table: string; pk: string | number }>
}

export function LineageDrawer({ factId, onClose }: { factId: string; onClose: () => void }) {
  const [data, setData] = useState<LineageResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/lineage/${encodeURIComponent(factId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<LineageResponse>
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
  }, [factId])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Fact Lineage</div>
            <div className="mt-1 font-mono text-sm text-neutral-800">{factId}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="close"
          >
            ✕
          </button>
        </div>

        {err ? (
          <div className="mt-6 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Could not load lineage: {err}
          </div>
        ) : !data ? (
          <div className="mt-6 text-sm text-neutral-500">Loading…</div>
        ) : (
          <div className="mt-6 space-y-6 text-sm">
            <Section title="Value">
              <Row label="metric" value={data.fact.metric} />
              <Row label="value" value={data.fact.value ?? '—'} />
              <Row label="time_window" value={data.fact.time_window ?? '—'} />
              <Row
                label="dims"
                value={
                  Object.entries(data.fact.dims)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' · ') || '—'
                }
              />
            </Section>

            <Section title="Trust">
              <Row label="data_health" value={data.fact.data_health ?? '—'} />
              <Row label="confidence" value={data.fact.confidence ?? '—'} />
              <Row label="sample_n" value={data.fact.sample_n ?? '—'} />
              <Row
                label="unstable"
                value={data.fact.unstable ? 'yes (outlier)' : 'no'}
              />
            </Section>

            <Section title="Formula">
              {data.formula ? (
                <>
                  <Row label="id" value={data.formula.id} />
                  <Row label="layer" value={data.formula.layer} />
                  <Row label="kind" value={data.formula.kind} />
                  <Row label="unit" value={data.formula.unit} />
                  <Row label="owner" value={data.formula.owner} />
                  <div className="mt-2 rounded bg-neutral-900 p-3 font-mono text-[12px] leading-relaxed text-neutral-100">
                    {data.formula.formula}
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    {data.formula.description}
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    inputs: {data.formula.inputs.join(', ')}
                  </div>
                </>
              ) : (
                <div className="text-neutral-500">
                  No registry entry for <span className="font-mono">{data.fact.formula_id ?? data.fact.metric}</span>. Add one in <span className="font-mono">src/lib/metrics/registry.ts</span>.
                </div>
              )}
            </Section>

            <Section title={`Source Rows (${data.source_rows.length})`}>
              {data.source_rows.length === 0 ? (
                <div className="text-neutral-500">
                  No source rows captured yet. Compute pipeline should populate <span className="font-mono">source_rows</span>.
                </div>
              ) : (
                <ul className="space-y-1">
                  {data.source_rows.map((s, i) => (
                    <li key={i} className="font-mono text-xs text-neutral-700">
                      {s.table} · pk={String(s.pk)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div className="pt-2 text-[11px] text-neutral-400">
              computed_at: {new Date(data.fact.computed_at).toLocaleString()}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-100 py-1 last:border-b-0">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="font-mono text-xs text-neutral-800">{String(value)}</span>
    </div>
  )
}
