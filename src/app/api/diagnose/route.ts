// W3.3 — L2 Diagnostic endpoint.
// POST /api/diagnose { sku, region, target?: 'units'|'revenue' }
// Pulls target series from v_sku_velocity + driver series (competitor pressure,
// inventory cover) via existing views, then runs decomposition + anomaly detect.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { decompose, type DriverInput, type Series } from '@/lib/diagnose/drivers'
import { detect } from '@/lib/diagnose/anomalies'

const Body = z.object({
  sku: z.string().min(1),
  region: z.string().min(1),
  target: z.enum(['units', 'revenue']).default('units'),
})

type VelocityRow = { sku_id: string; region: string; week: string; units: number | string; revenue?: number | string }
type CompSignalRow = { detected_at: string; urgent: boolean | null }
type InvRow = { sku_id: string; region: string; snapshot_date: string; cover_ratio: number | string }

function toWeek(iso: string): string {
  return iso.slice(0, 10)
}

// Snap ISO date to the Monday of its week — matches v_sku_velocity.week format
// so competitor pressure bucket aligns with velocity + inventory series.
function weekStart(iso: string): string {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 })
  }
  const { sku, region, target } = body

  const [velRes, invRes, compRes, factRes] = await Promise.all([
    supabase.from('v_sku_velocity').select('*').eq('sku_id', sku).eq('region', region),
    supabase.from('v_inventory_risk').select('*').eq('sku_id', sku).eq('region', region),
    // v_competitor_pressure is a category rollup with no week column, so we go
    // to the raw table and bucket by ISO-week Monday to align with velocity.
    supabase.from('competitor_signal').select('detected_at, urgent'),
    supabase
      .from('facts')
      .select('id, metric, dims')
      .in('metric', ['sku_velocity_delta', 'competitor_pressure_pct', 'inventory_cover_ratio']),
  ])

  for (const r of [velRes, invRes, compRes, factRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }

  const velocity = (velRes.data ?? []) as VelocityRow[]
  const inventory = (invRes.data ?? []) as InvRow[]
  const compSignals = (compRes.data ?? []) as CompSignalRow[]

  const targetSeries: Series[] = velocity
    .map((r) => ({
      week: weekStart(r.week),
      value: Number(target === 'revenue' ? (r.revenue ?? r.units) : r.units),
    }))
    .filter((s) => Number.isFinite(s.value))

  const invSeries: Series[] = inventory
    .map((r) => ({ week: weekStart(r.snapshot_date), value: Number(r.cover_ratio) }))
    .filter((s) => Number.isFinite(s.value))

  const compByWeek: Record<string, { total: number; urgent: number }> = {}
  for (const s of compSignals) {
    if (!s.detected_at) continue
    const wk = weekStart(s.detected_at)
    const bucket = (compByWeek[wk] ??= { total: 0, urgent: 0 })
    bucket.total += 1
    if (s.urgent) bucket.urgent += 1
  }
  const compSeries: Series[] = Object.entries(compByWeek)
    .map(([week, b]) => ({ week, value: b.total ? (b.urgent / b.total) * 100 : 0 }))
    .sort((a, b) => a.week.localeCompare(b.week))

  const findFact = (metric: string, dims: Record<string, unknown>): string[] => {
    return (factRes.data ?? [])
      .filter((f) => {
        if (f.metric !== metric) return false
        const d = (f.dims ?? {}) as Record<string, unknown>
        for (const [k, v] of Object.entries(dims)) if (d[k] !== v) return false
        return true
      })
      .map((f) => f.id)
  }

  const drivers: DriverInput[] = [
    { name: 'inventory_cover_ratio', series: invSeries, fact_ids: findFact('inventory_cover_ratio', { sku, region }) },
    { name: 'competitor_pressure_pct', series: compSeries, fact_ids: findFact('competitor_pressure_pct', {}) },
  ].filter((d) => d.series.length >= 6)

  const decomposition = decompose(
    { name: target === 'revenue' ? 'revenue' : 'units', series: targetSeries },
    drivers,
  )

  const anomalies = detect(targetSeries)

  const targetFactIds = findFact('sku_velocity_delta', { sku, region })

  return NextResponse.json({
    target: { sku, region, metric: target, n_weeks: targetSeries.length, fact_ids: targetFactIds },
    decomposition,
    anomalies,
    note:
      'Driver contributions are correlation-based (ridge regression), not causal. ' +
      'Treat as hypotheses to test, not proof.',
  })
}
