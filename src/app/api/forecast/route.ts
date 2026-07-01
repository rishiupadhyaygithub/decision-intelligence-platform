// W4.3 — L3 Predictive forecast endpoint.
// POST /api/forecast { sku, region, horizon?: 1..12, target?: 'units'|'revenue' }
// Returns fitted values, P10/P50/P90 bands, model params, and cited fact_ids
// so every displayed prediction traces back to inputs.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { forecast, type Series } from '@/lib/predict/forecast'

const Body = z.object({
  sku: z.string().min(1),
  region: z.string().min(1),
  horizon: z.number().int().min(1).max(12).default(4),
  target: z.enum(['units', 'revenue']).default('units'),
})

type VelocityRow = { sku_id: string; region: string; week: string; units: number | string; revenue?: number | string }

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
  const { sku, region, horizon, target } = body

  const [velRes, factRes] = await Promise.all([
    supabase.from('v_sku_velocity').select('*').eq('sku_id', sku).eq('region', region),
    supabase
      .from('facts')
      .select('id, metric, dims')
      .in('metric', ['sku_velocity_delta', 'demand_forecast_next']),
  ])

  for (const r of [velRes, factRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }

  const rows = (velRes.data ?? []) as VelocityRow[]
  const series: Series[] = rows
    .map((r) => ({
      week: toWeek(r.week),
      value: Number(target === 'revenue' ? (r.revenue ?? r.units) : r.units),
    }))
    .filter((s) => Number.isFinite(s.value))

  const out = forecast(series, horizon)

  const inputFactIds = (factRes.data ?? [])
    .filter((f) => {
      const d = (f.dims ?? {}) as Record<string, unknown>
      return f.metric === 'sku_velocity_delta' && d.sku === sku && d.region === region
    })
    .map((f) => f.id)

  return NextResponse.json({
    target: { sku, region, metric: target, n_history: series.length },
    history: series,
    forecast: out,
    input_fact_ids: inputFactIds,
    note:
      out.point.length === 0
        ? 'Not enough history to forecast (need >= 6 weeks).'
        : 'Damped exponential smoothing with residual bootstrap bands. Retrained per request.',
  })
}
