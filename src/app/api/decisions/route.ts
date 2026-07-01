import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'

const Analysis = z.object({
  summary: z.string(),
  recommendation: z.string(),
  top_risks: z.array(
    z.object({
      risk: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
      fact_id: z.string().nullable().optional(),
    }),
  ),
  alternatives: z.array(z.object({ option: z.string(), tradeoff: z.string() })),
  data_health_score: z.number(),
  confidence: z.number(),
  model: z.string().optional(),
  grounded: z.literal(true),
  facts_used: z.array(
    z.object({
      id: z.string(),
      metric: z.string(),
      value: z.union([z.number(), z.string()]).nullable(),
      window: z.string().nullable(),
    }),
  ),
  validation: z.object({ ok: z.literal(true), violations: z.array(z.any()) }),
})

const Body = z.object({
  id: z.string().min(1).max(32),
  title: z.string().min(1).max(500),
  type: z.string(),
  urgency: z.string(),
  problem: z.string().max(5000),
  whynow: z.string().max(2000).optional(),
  analysis: Analysis,
})

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await request.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid decision payload' }, { status: 400 })
  }

  const payload = {
    ...parsed.data,
    proposer: user.email ?? user.id,
    role: 'member',
    whynow: parsed.data.whynow ?? '',
  }

  const { data, error } = await supabase.rpc('save_decision_bundle', { payload })
  if (error) {
    console.error('save_decision_bundle', error)
    return NextResponse.json({ error: 'Failed to save decision' }, { status: 500 })
  }

  return NextResponse.json({ id: data })
}
