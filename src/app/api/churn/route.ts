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
    .in('metric', ['sku_velocity_delta', 'inventory_cover_ratio', 'competitor_pressure_pct', 'churn_risk'])

  if (error) {
    console.error('churn: facts query failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
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

  // The trained model answers a DIFFERENT question than the rule-based score, so it is
  // returned alongside, never substituted: ml/churn.py predicts next week's units falling
  // >15% below the trailing-3-week mean; churn() estimates losing >20% next quarter.
  const ml = pick('churn_risk', { sku, region })

  const cited = [vel?.id, inv?.id, comp?.id, ml?.id].filter(Boolean) as string[]

  return NextResponse.json({
    target: { sku, region },
    churn: out,
    ml_churn:
      ml && ml.value != null
        ? {
            risk_score: Number(ml.value),
            predicts: 'next-week units fall >15% below trailing-3-week mean',
            method: 'ml:logreg (ml/churn.py, offline pipeline)',
            fact_id: ml.id,
          }
        : null,
    cited_fact_ids: cited,
    note:
      'churn = rule-based logistic estimate of losing >20% next quarter. ' +
      'ml_churn = logistic regression trained offline on velocity history (different horizon). ' +
      'Competitor pressure is category-level: competitor_signal has no sku/region columns.',
  })
}
