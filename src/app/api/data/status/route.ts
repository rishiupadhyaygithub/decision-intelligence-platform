// GET /api/data/status — what dataset this deployment is running on, how big it is,
// how fresh the facts are, and whether the caller may import.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { adminEmails, isAdmin } from '@/lib/data/admin'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true })
  const [mode, skus, sales, inventory, signals, facts, latestFact, latestSale, jobs] = await Promise.all([
    supabase.from('app_settings').select('value, updated_at').eq('key', 'data_mode').maybeSingle(),
    count('sku'),
    count('sales'),
    count('inventory'),
    count('competitor_signal'),
    count('facts'),
    supabase.from('facts').select('computed_at').order('computed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales').select('sale_date').order('sale_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('job_runs').select('job, status, started_at, detail').order('started_at', { ascending: false }).limit(5),
  ])

  return NextResponse.json({
    // A pre-0018 database has no app_settings table and can only hold the demo data.
    data_mode: mode.data?.value ?? 'demo',
    data_mode_since: mode.data?.updated_at ?? null,
    counts: {
      skus: skus.count ?? 0,
      sales: sales.count ?? 0,
      inventory: inventory.count ?? 0,
      signals: signals.count ?? 0,
      facts: facts.count ?? 0,
    },
    facts_computed_at: latestFact.data?.computed_at ?? null,
    latest_sale_date: latestSale.data?.sale_date ?? null,
    recent_jobs: jobs.data ?? [],
    can_import: isAdmin(user.email),
    admin_configured: adminEmails().length > 0,
  })
}
