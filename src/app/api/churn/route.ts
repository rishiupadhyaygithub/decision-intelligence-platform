// W4.3b — Churn risk endpoint.
// POST /api/churn { sku, region } → risk_score + band + reasons + cited fact_ids.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { churn } from '@/lib/predict/churn'

const Body = z.object({ sku: z.string().min(1), region: z.string().min(1) })

type FactRow = { id: string; metric: string; dims: Record<string, unknown>; value: number | null }

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
  const { sku, region } = body

  const { data, error } = await supabase
    .from('facts')
    .select('id, metric, dims, value')
    .in('metric', ['sku_velocity_delta', 'inventory_cover_ratio', 'competitor_pressure_pct'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const facts = (data ?? []) as FactRow[]

  const pick = (metric: string, dims: Record<string, unknown>): FactRow | undefined =>
    facts.find((f) => {
      if (f.metric !== metric) return false
      const d = (f.dims ?? {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(dims)) if (d[k] !== v) return false
      return true
    })

  const vel = pick('sku_velocity_delta', { sku, region })
  const inv = pick('inventory_cover_ratio', { sku, region })
  const comp = facts.find((f) => f.metric === 'competitor_pressure_pct')

  const out = churn({
    velocity_delta_pct: vel?.value ?? null,
    cover_ratio: inv?.value ?? null,
    competitor_pressure_pct: comp?.value ?? null,
  })

  const cited = [vel?.id, inv?.id, comp?.id].filter(Boolean) as string[]

  return NextResponse.json({
    target: { sku, region },
    churn: out,
    cited_fact_ids: cited,
    note:
      'Rule-based logistic — fast in-process scoring. ' +
      'Python GBM (ml/churn.py) runs offline via facts pipeline for a stronger baseline.',
  })
}
