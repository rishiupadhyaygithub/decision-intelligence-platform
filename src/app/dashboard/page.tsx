import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/TopNav'
import { StatCard, SeverityPill, SyntheticNote } from '@/components/decisionos'
import DashboardCharts from '@/components/DashboardCharts'

type FactRow = { metric: string; dims: Record<string, string>; value: number | null }

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [dRes, sRes, openRes, reviewRes, factsRes, revRes, jobsRes] = await Promise.all([
    supabase
      .from('decisions')
      .select('id,title,type,urgency,status,created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('competitor_signal')
      .select('id,source,category,body,impact,urgent,detected_at')
      .order('detected_at', { ascending: false })
      .limit(8),
    supabase
      .from('decisions')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'review']),
    supabase.from('decisions').select('*', { count: 'exact', head: true }).eq('status', 'review'),
    supabase.from('facts').select('metric,dims,value').in('metric', ['demand_forecast_next', 'churn_risk', 'signal_sentiment']),
    supabase.from('v_revenue_by_region_daily').select('sale_date,revenue'),
    supabase
      .from('job_runs')
      .select('id,job,status,rows_affected,finished_at,duration_ms')
      .order('started_at', { ascending: false })
      .limit(5),
  ])

  const jobs = (jobsRes.data ?? []) as {
    id: number
    job: string
    status: string
    rows_affected: number | null
    finished_at: string | null
    duration_ms: number | null
  }[]

  const facts = (factsRes.data ?? []) as FactRow[]
  const forecast = facts
    .filter((f) => f.metric === 'demand_forecast_next')
    .map((f) => ({ label: f.dims.region ?? '?', value: Number(f.value ?? 0) }))
  const churn = facts
    .filter((f) => f.metric === 'churn_risk')
    .map((f) => ({ label: `${f.dims.sku ?? '?'} · ${f.dims.region ?? ''}`.trim(), value: Number(f.value ?? 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
  const sentiment = facts
    .filter((f) => f.metric === 'signal_sentiment')
    .map((f) => ({ label: f.dims.category ?? '?', value: Number(f.value ?? 0) }))
  const revByDay: Record<string, number> = {}
  for (const r of (revRes.data ?? []) as { sale_date: string; revenue: number }[]) {
    revByDay[r.sale_date] = (revByDay[r.sale_date] ?? 0) + Number(r.revenue)
  }
  const revenue = Object.entries(revByDay)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, rev]) => ({ date: date.slice(5), revenue: Math.round(rev) }))

  const dbError = dRes.error || sRes.error
  const decisions = dRes.data ?? []
  const signals = sRes.data ?? []
  const open = openRes.count ?? 0
  const inReview = reviewRes.count ?? 0
  const urgent = signals.filter((s) => s.urgent).length

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav email={user.email} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Decision workspace</h2>
            <SyntheticNote />
          </div>
          <Link
            href="/dashboard/new-decision"
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + New decision
          </Link>
        </div>

        {dbError && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Could not load workspace data: {dbError.message}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatCard label="Open decisions" value={open} />
          <StatCard label="Urgent signals" value={urgent} hint={`${signals.length} tracked`} />
          <StatCard label="Awaiting review" value={inReview} />
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Signals · grounded in computed facts</h3>
          <span className="text-xs text-slate-400">statistical + ML · {forecast.length + churn.length + sentiment.length} live facts charted</span>
        </div>
        <DashboardCharts revenue={revenue} forecast={forecast} churn={churn} sentiment={sentiment} />

        <section className="bg-white rounded-xl border border-slate-200 p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-slate-900 text-sm">System health · pipeline runs</h3>
            <span className="text-xs text-slate-400">ingest → facts → ML retrain · scheduled</span>
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">
              No pipeline runs yet. Run <code className="text-xs bg-slate-100 px-1 rounded">node scripts/pipeline/run.mjs</code> or trigger the GitHub Action.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 py-2 text-sm">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      j.status === 'ok' ? 'bg-emerald-500' : j.status === 'error' ? 'bg-red-500' : 'bg-amber-400'
                    }`}
                  />
                  <span className="font-medium text-slate-700 w-20">{j.job}</span>
                  <span className="text-slate-500 capitalize w-16">{j.status}</span>
                  <span className="text-slate-400 flex-1">{j.rows_affected ?? '—'} rows</span>
                  <span className="text-xs text-slate-400">{j.duration_ms ?? '—'} ms</span>
                  <span className="text-xs text-slate-400 hidden sm:inline">
                    {j.finished_at ? new Date(j.finished_at).toLocaleString() : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-medium text-slate-900 mb-3">Recent decisions</h3>
            {decisions.length === 0 ? (
              <p className="text-center py-10 text-slate-400 text-sm">
                No decisions yet. Create your first one.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {decisions.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/dashboard/decisions/${d.id}`}
                      className="flex items-center justify-between py-3 -mx-2 px-2 rounded hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{d.title}</p>
                        <p className="text-xs text-slate-400">
                          {d.type} · {d.urgency}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500 capitalize shrink-0">{d.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-medium text-slate-900 mb-3">Market signals</h3>
            {signals.length === 0 ? (
              <p className="text-center py-10 text-slate-400 text-sm">
                No signals. Run npm run go-live to load seed data.
              </p>
            ) : (
              <ul className="space-y-3">
                {signals.map((s) => (
                  <li key={s.id} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-600">
                        {s.category} · {s.source}
                      </span>
                      <SeverityPill severity={s.impact} />
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2">{s.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
