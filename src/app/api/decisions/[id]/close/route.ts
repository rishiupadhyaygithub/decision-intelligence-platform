import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { harvestDecisionMemory } from '@/lib/memory/harvest'

// Loop-closure trigger: mark a decision closed, then harvest a memory row from
// its predicted-vs-actual outcomes. Memory is computed in code by the harvester
// (grounding contract) — this route only sets status and invokes it.
export async function POST(
  _request: Request,
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

  // RLS scopes this to the owner; 404 if not found/not owned.
  const { data: decision, error: lookupError } = await supabase
    .from('decisions')
    .select('id, status')
    .eq('id', decisionId)
    .maybeSingle()
  if (lookupError) {
    console.error('close decision lookup', lookupError)
    return NextResponse.json({ error: 'Failed to load decision' }, { status: 500 })
  }
  if (!decision) {
    return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
  }

  // Require at least one measured outcome before closing — harvest needs actuals.
  const { count } = await supabase
    .from('outcomes')
    .select('id', { count: 'exact', head: true })
    .eq('decision_id', decisionId)
  if (!count) {
    return NextResponse.json(
      { error: 'Cannot close: no measured outcome recorded yet' },
      { status: 409 },
    )
  }

  const { error: updateError } = await supabase
    .from('decisions')
    .update({ status: 'closed' })
    .eq('id', decisionId)
  if (updateError) {
    console.error('close decision update', updateError)
    return NextResponse.json({ error: 'Failed to close decision' }, { status: 500 })
  }

  try {
    const memory = await harvestDecisionMemory(supabase, decisionId)
    return NextResponse.json({ status: 'closed', memory }, { status: 200 })
  } catch (err) {
    console.error('harvest after close', err)
    // Decision is closed; surface the harvest failure without masking it.
    return NextResponse.json(
      { status: 'closed', memory: null, harvestError: String(err) },
      { status: 200 },
    )
  }
}
