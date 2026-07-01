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
type CompPressureRow = { category: string; week?: string; urgent_signals: number | string; total_signals: number | string }
type InvRow = { sku_id: string; region: string; snapshot_date: string; cover_ratio: number | string }

function toWeek(iso: string): string {
  return iso.slice(0, 10)
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
    supabase.from('v_competitor_pressure').select('*'),
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
  const competitor = (compRes.data ?? []) as CompPressureRow[]

  const targetSeries: Series[] = velocity
    .map((r) => ({
      week: toWeek(r.week),
      value: Number(target === 'revenue' ? (r.revenue ?? r.units) : r.units),
    }))
    .filter((s) => Number.isFinite(s.value))

  const invSeries: Series[] = inventory
    .map((r) => ({ week: toWeek(r.snapshot_date), value: Number(r.cover_ratio) }))
    .filter((s) => Number.isFinite(s.value))

  const compSeries: Series[] = competitor
    .filter((r) => r.week)
    .map((r) => {
      const total = Number(r.total_signals) || 0
      const urgent = Number(r.urgent_signals) || 0
      return { week: toWeek(r.week!), value: total ? (urgent / total) * 100 : 0 }
    })

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
