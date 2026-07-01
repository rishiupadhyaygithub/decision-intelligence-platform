import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'

const Body = z.object({
  metric: z.string().min(1).max(200),
  predicted: z.number(),
  actual: z.number(),
  horizon: z.string().max(100).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: decisionId } = await params

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
    return NextResponse.json({ error: 'Invalid outcome payload' }, { status: 400 })
  }

  // Verify the decision exists and belongs to the user. RLS also enforces this,
  // but we check explicitly to return a clean 404 rather than a silent failure.
  const { data: decision, error: lookupError } = await supabase
    .from('decisions')
    .select('id')
    .eq('id', decisionId)
    .maybeSingle()
  if (lookupError) {
    console.error('outcome decision lookup', lookupError)
    return NextResponse.json({ error: 'Failed to load decision' }, { status: 500 })
  }
  if (!decision) {
    return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('outcomes')
    .insert({
      decision_id: decisionId,
      metric: parsed.data.metric,
      predicted: parsed.data.predicted,
      actual: parsed.data.actual,
      horizon: parsed.data.horizon ?? null,
      measured_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) {
    console.error('outcome insert', error)
    return NextResponse.json({ error: 'Failed to save outcome' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
