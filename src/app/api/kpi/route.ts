// W2.1 — L1 Descriptive endpoint.
// Returns headline KPIs, each carrying its originating fact_id + data_health.
// UI must render every number with a lineage handle back to the fact.

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { metricLabel } from '@/lib/labels'

type FactRow = {
  id: string
  metric: string
  dims: Record<string, unknown>
  value: number | null
  value_text: string | null
  data_health: number | null
  confidence: number | null
  unstable: boolean | null
  computed_at: string
}

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

// Plain-language labels come from src/lib/labels.ts. revenue_anomaly_z is left out of
// the default set: the 4-week revenue trend says the same thing without a z-score.
const UNITS: Record<string, Kpi['unit']> = {
  sku_velocity_delta: 'pct',
  inventory_cover_ratio: 'ratio',
  margin_pct: 'pct',
  revenue_trend_recent: 'pct',
  competitor_pressure_pct: 'pct',
}
const LABELS: Record<string, { label: string; unit: Kpi['unit'] }> = Object.fromEntries(
  Object.entries(UNITS).map(([m, unit]) => [m, { label: metricLabel(m), unit }]),
)

function toKpi(f: FactRow): Kpi {
  const meta = LABELS[f.metric] ?? { label: metricLabel(f.metric), unit: 'count' as const }
  return {
    key: `${f.metric}:${JSON.stringify(f.dims)}`,
    label: meta.label,
    value: f.value,
    unit: meta.unit,
    fact_id: f.id,
    data_health: f.data_health,
    unstable: !!f.unstable,
    dims: f.dims ?? {},
  }
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const metricsParam = url.searchParams.get('metrics')
  const minHealth = Number(url.searchParams.get('min_health') ?? '0')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '24'), 200)
  // Optional context: only facts about this product and/or region, most specific first.
  const sku = url.searchParams.get('sku')
  const region = url.searchParams.get('region')

  const metrics = metricsParam
    ? metricsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(LABELS)

  const { data, error } = await supabase
    .from('facts')
    .select(
      'id, metric, dims, value, value_text, data_health, confidence, unstable, computed_at',
    )
    .in('metric', metrics)
    .order('computed_at', { ascending: false })
    .limit(sku || region ? 200 : limit)

  if (error) {
    console.error('kpi: query failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }

  let rows = (data ?? []) as FactRow[]
  if (sku || region) {
    const relevance = (r: FactRow) => {
      const s = r.dims?.sku
      const g = r.dims?.region
      if (sku && region && s === sku && g === region) return 3
      if (sku && s === sku && g == null) return 2
      if (region && g === region && s == null) return 2
      return 0
    }
    rows = rows
      .map((r) => ({ r, score: relevance(r) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || metrics.indexOf(a.r.metric) - metrics.indexOf(b.r.metric))
      .map((x) => x.r)
      .slice(0, limit)
  }
  const filtered = minHealth > 0
    ? rows.filter((r) => (r.data_health ?? 0) >= minHealth)
    : rows

  const kpis = filtered.map(toKpi)
  const scored = filtered.filter((r) => typeof r.data_health === 'number')
  const meanHealth = scored.length
    ? scored.reduce((a, b) => a + (b.data_health ?? 0), 0) / scored.length
    : 0

  return NextResponse.json({
    kpis,
    meta: {
      count: kpis.length,
      mean_health: Number(meanHealth.toFixed(3)),
      flagged_unstable: kpis.filter((k) => k.unstable).length,
      generated_at: new Date().toISOString(),
    },
  })
}
