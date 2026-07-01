// W2.1 — L1 Descriptive endpoint.
// Returns headline KPIs, each carrying its originating fact_id + data_health.
// UI must render every number with a lineage handle back to the fact.

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

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

const LABELS: Record<string, { label: string; unit: Kpi['unit'] }> = {
  revenue_trend_recent: { label: 'Revenue Trend (recent vs base)', unit: 'pct' },
  revenue_anomaly_z: { label: 'Revenue Anomaly (z-score)', unit: 'score' },
  margin_pct: { label: 'Margin %', unit: 'pct' },
  sku_velocity_delta: { label: 'SKU Velocity Δ', unit: 'pct' },
  inventory_cover_ratio: { label: 'Inventory Cover', unit: 'ratio' },
  competitor_pressure_pct: { label: 'Competitor Pressure %', unit: 'pct' },
}

function toKpi(f: FactRow): Kpi {
  const meta = LABELS[f.metric] ?? { label: f.metric, unit: 'count' as const }
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
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as FactRow[]
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
