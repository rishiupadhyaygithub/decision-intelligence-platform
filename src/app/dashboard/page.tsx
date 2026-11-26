import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SyntheticNote } from '@/components/decisionos'
import IssueList from '@/components/brief/IssueList'
import RevenueChart from '@/components/brief/RevenueChart'
import { buildBrief, compact, type FactLike } from '@/lib/brief'

const DAY = 864e5
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3.6e6
  return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`
}

export default async function BriefPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const since12w = new Date(Date.now() - 12 * 7 * DAY).toISOString().slice(0, 10)
  const since26w = new Date(Date.now() - 26 * 7 * DAY).toISOString().slice(0, 10)
  const [factsRes, skuRes, velRes, revRes, decRes, sigRes] = await Promise.all([
    supabase.from('facts').select('id,metric,dims,value,sample_n,computed_at'),
    supabase.from('sku').select('sku_id,name'),
    supabase.from('v_sku_velocity').select('sku_id,region,week,units').gte('week', since12w).order('week'),
    supabase.from('v_revenue_by_region_daily').select('sale_date,region,revenue').gte('sale_date', since26w).order('sale_date'),
    supabase.from('decisions').select('id,title,urgency,status,created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('competitor_signal').select('id,category,body,impact,urgent,detected_at').order('detected_at', { ascending: false }).limit(5),
  ])

  const facts = (factsRes.data ?? []) as (FactLike & { computed_at: string })[]
  const skuNames = Object.fromEntries((skuRes.data ?? []).map((s) => [s.sku_id, s.name]))
  const issues = buildBrief(facts, skuNames)
  const refreshed = facts.reduce<string | null>((m, f) => (!m || f.computed_at > m ? f.computed_at : m), null)

  // Weekly units per sku|region for sparklines (channels summed).
  const series: Record<string, number[]> = {}
  const weekly: Record<string, Record<string, number>> = {}
  for (const r of (velRes.data ?? []) as { sku_id: string; region: string; week: string; units: number }[]) {
    const k = `${r.sku_id}|${r.region}`
    ;(weekly[k] ??= {})[r.week] = (weekly[k][r.week] ?? 0) + Number(r.units)
  }
  for (const [k, byWeek] of Object.entries(weekly)) series[k] = Object.keys(byWeek).sort().map((w) => byWeek[w])

  // Revenue per week, all regions.
  const revByWeek: Record<string, number> = {}
  for (const r of (revRes.data ?? []) as { sale_date: string; revenue: number }[]) {
    revByWeek[r.sale_date] = (revByWeek[r.sale_date] ?? 0) + Number(r.revenue)
  }
  const revenue = Object.keys(revByWeek)
    .sort()
    .map((week) => ({ week, revenue: Math.round(revByWeek[week]) }))
  const lastRev = revenue.at(-1)?.revenue ?? 0
  const prior4 = revenue.slice(-5, -1)
  const prior4Avg = prior4.length ? prior4.reduce((s, r) => s + r.revenue, 0) / prior4.length : 0
  const revChange = prior4Avg ? ((lastRev - prior4Avg) / prior4Avg) * 100 : null

  const forecast = facts
    .filter((f) => f.metric === 'demand_forecast_next' && f.value != null)
    .map((f) => ({ region: String(f.dims.region), units: Number(f.value) }))
    .sort((a, b) => b.units - a.units)
  const maxF = Math.max(1, ...forecast.map((f) => f.units))

  const act = issues.filter((i) => i.tone === 'act').length
  const watch = issues.filter((i) => i.tone === 'watch').length
  const weekOf = new Date(Date.now() - ((new Date().getUTCDay() + 6) % 7) * DAY)
  const decisions = decRes.data ?? []
  const signals = sigRes.data ?? []

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-8 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Week of {fmtDay(weekOf)}</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">
            {act ? `${act} thing${act > 1 ? 's' : ''} need${act > 1 ? '' : 's'} a decision` : watch ? `${watch} thing${watch > 1 ? 's' : ''} to watch` : 'All clear this week'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Ranked from {facts.length} computed facts{refreshed ? `, refreshed ${ago(refreshed)}` : ''}. Every number links to its evidence.
          </p>
          <SyntheticNote />
        </div>
        <Link
          href="/dashboard/new-decision"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:border-slate-400 transition-colors"
        >
          Ask about something else
        </Link>
      </header>

      <section className="mt-8" aria-labelledby="needs">
        <h2 id="needs" className="sr-only">Needs a decision</h2>
        <IssueList issues={issues} series={series} />
      </section>

      <section className="mt-10 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Revenue by week</h2>
            <p className="text-sm text-slate-500">
              Last week <span className="font-semibold text-slate-900">{compact(lastRev)}</span>
              {revChange != null && (
                <span className={revChange >= 0 ? 'text-shelf' : 'text-act'}>
                  {' '}
                  ({revChange >= 0 ? '+' : ''}
                  {revChange.toFixed(1)}% vs prior 4 weeks)
                </span>
              )}
            </p>
          </div>
          <div className="mt-4">
            <RevenueChart data={revenue} />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Expected units next month</h2>
          <p className="mt-1 text-sm text-slate-500">Trend forecast per region</p>
          <ul className="mt-5 space-y-4">
            {forecast.map((f) => (
              <li key={f.region}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-700">{f.region}</span>
                  <span className="num font-semibold text-slate-900">{compact(f.units)}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(f.units / maxF) * 100}%` }} />
                </div>
              </li>
            ))}
            {!forecast.length && <li className="text-sm text-slate-500">No forecast yet. It appears after the next pipeline run.</li>}
          </ul>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-900">Your recent decisions</h2>
            <Link href="/dashboard/inbox" className="text-sm text-indigo-700 hover:underline">
              All decisions
            </Link>
          </div>
          {decisions.length ? (
            <ul className="mt-3 divide-y divide-line">
              {decisions.map((d) => (
                <li key={d.id}>
                  <Link href={`/dashboard/decisions/${d.id}`} className="flex items-center justify-between gap-4 py-3 group">
                    <span className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-950">{d.title}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs capitalize text-slate-600">{d.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No decisions yet. Pick an item above and press Decide.</p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Market signals</h2>
          <ul className="mt-3 space-y-3">
            {signals.map((s) => (
              <li key={s.id} className="flex gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.impact === 'high' ? 'bg-act' : s.impact === 'medium' ? 'bg-watch' : 'bg-slate-300'}`}
                  aria-label={`${s.impact} impact`}
                />
                <p className="text-sm text-slate-700 leading-snug">
                  <span className="font-medium text-slate-900">{s.category}.</span> {s.body}
                </p>
              </li>
            ))}
            {!signals.length && <li className="text-sm text-slate-500">No market signals yet.</li>}
          </ul>
        </div>
      </section>
    </main>
  )
}
