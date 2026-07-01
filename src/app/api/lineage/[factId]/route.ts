// W2.x — Lineage lookup for a single fact_id.
// Powers the Lineage Drawer: click any number → fetch fact + formula + source rows.

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getMetric } from '@/lib/metrics/registry'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ factId: string }> },
) {
  const { factId } = await ctx.params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('facts')
    .select('*')
    .eq('id', factId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const spec = getMetric(data.formula_id ?? data.metric)

  return NextResponse.json({
    fact: data,
    formula: spec ?? null,
    source_rows: data.source_rows ?? [],
  })
}
