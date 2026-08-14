import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. Fetch decision basics
  const { data: decision, error: dErr } = await supabase
    .from('decisions')
    .select('id, title, type, status, created_at, decision_enrichment(summary, recommendation)')
    .eq('id', id)
    .single()

  if (dErr || !decision) {
    return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
  }

  // 2. Fetch the immutable citation snapshots
  const { data: facts, error: fErr } = await supabase
    .from('decision_facts')
    .select('claim_index, claim_type, fact_id, fact_snapshot, captured_at')
    .eq('decision_id', id)
    .order('claim_type')
    .order('claim_index')

  if (fErr) {
    return NextResponse.json({ error: 'Failed to fetch lineage' }, { status: 500 })
  }

  // Restructure into a tree: Decision -> Claim -> Evidence -> Fact Snapshot
  const lineage = {
    decision: {
      id: decision.id,
      title: decision.title,
      type: decision.type,
      status: decision.status,
      created_at: decision.created_at,
      enrichment: decision.decision_enrichment
    },
    claims: facts.filter(f => f.claim_type === 'claim'),
    risks: facts.filter(f => f.claim_type === 'risk'),
    alternatives: facts.filter(f => f.claim_type === 'alternative')
  }

  return NextResponse.json({ lineage })
}
