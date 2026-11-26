import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

// The decision log: what was accepted or dismissed, and what actually happened.
// Results are measured automatically: actual weekly units after the decision week
// against the weekly demand the engine expected when the decision was made.

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const TYPE: Record<string, string> = { restock: 'Restock', transfer: 'Move stock', promote: 'Clear excess' }

type Row = {
  id: string
  action_key: string
  week_start: string
  type: string
  sku: string
  region: string
  from_region: string | null
  status: 'accepted' | 'dismissed'
  quantity: number | null
  discount: number | null
  projected: { impact?: { revenue?: number; margin?: number }; adjusted?: boolean } | null
  baseline_weekly: number | null
  reason: string | null
  created_at: string
}

export default async function LogPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [actRes, qRes, skuRes] = await Promise.all([
    supabase.from('action_decisions').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('decisions').select('id,title,status,created_at').order('created_at', { ascending: false }).limit(20),
    supabase.from('sku').select('sku_id,name'),
  ])
  const rows = (actRes.data ?? []) as Row[]
  const names = Object.fromEntries((skuRes.data ?? []).map((s) => [s.sku_id, s.name]))

  // Sales after each accepted decision's week, for automatic measurement.
  const accepted = rows.filter((r) => r.status === 'accepted')
  const earliest = accepted.reduce<string | null>((m, r) => (!m || r.week_start < m ? r.week_start : m), null)
  const after: Record<string, { week: string; units: number }[]> = {}
  if (earliest) {
    const { data } = await supabase.from('v_sku_velocity').select('sku_id,region,week,units').gt('week', earliest).order('week')
    for (const v of (data ?? []) as { sku_id: string; region: string; week: string; units: number }[]) {
      ;(after[`${v.sku_id}|${v.region}`] ??= []).push({ week: v.week, units: Number(v.units) })
    }
  }
  const result = (r: Row) => {
    const weeks = (after[`${r.sku}|${r.region}`] ?? []).filter((w) => w.week > r.week_start)
    if (!weeks.length || !r.baseline_weekly) return null
    const actual = weeks.reduce((s, w) => s + w.units, 0) / weeks.length
    return { weeks: weeks.length, actual, vs: ((actual - r.baseline_weekly) / r.baseline_weekly) * 100 }
  }

  const projectedTotal = accepted.reduce((s, r) => s + Number(r.projected?.impact?.revenue ?? 0), 0)
  const measured = accepted.map(result).filter(Boolean).length
  const questions = qRes.data ?? []

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8 py-8 lg:py-12">
      <h1 className="text-3xl sm:text-[40px] font-semibold leading-tight tracking-tight text-slate-900">Decision log</h1>
      <p className="mt-2 max-w-2xl text-base text-slate-600">
        Everything you accepted or dismissed, and how it turned out. Results are measured automatically from the weekly sales that follow.
      </p>

      <section className="mt-6 grid grid-cols-1 sm:grid-cols-3 overflow-hidden rounded-2xl border border-line bg-white divide-y sm:divide-y-0 sm:divide-x divide-line">
        <div className="px-6 py-5">
          <p className="num text-3xl font-semibold text-slate-900">{accepted.length}</p>
          <p className="mt-1 text-sm text-slate-600">actions accepted</p>
        </div>
        <div className="px-6 py-5">
          <p className="num text-3xl font-semibold text-shelf">{money(projectedTotal)}</p>
          <p className="mt-1 text-sm text-slate-600">of sales they were expected to protect or add</p>
        </div>
        <div className="px-6 py-5">
          <p className="num text-3xl font-semibold text-slate-900">{measured}</p>
          <p className="mt-1 text-sm text-slate-600">with measured results so far</p>
        </div>
      </section>

      <section className="mt-8">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white px-6 py-10 text-center">
            <p className="text-base font-medium text-slate-900">No decisions yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Accept or dismiss an action in the{' '}
              <Link href="/dashboard" className="text-indigo-700 underline underline-offset-2">
                inbox
              </Link>{' '}
              and it appears here with its result.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {rows.map((r) => {
              const res = r.status === 'accepted' ? result(r) : null
              const what =
                r.type === 'promote'
                  ? `${Math.round(Number(r.discount ?? 0) * 100)}% off ${names[r.sku] ?? r.sku} in ${r.region}`
                  : r.type === 'transfer'
                    ? `Moved ${Number(r.quantity ?? 0).toLocaleString('en-IN')} units of ${names[r.sku] ?? r.sku} from ${r.from_region} to ${r.region}`
                    : `Ordered ${Number(r.quantity ?? 0).toLocaleString('en-IN')} units of ${names[r.sku] ?? r.sku} for ${r.region}`
              return (
                <li key={r.id} className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-x-6 gap-y-2 px-6 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-500">
                      {TYPE[r.type]}, {r.status === 'accepted' ? (r.projected?.adjusted ? 'accepted with changes' : 'accepted') : 'dismissed'} on {fmtDay(r.created_at)}
                    </p>
                    <p className={`mt-0.5 text-[15px] font-medium ${r.status === 'accepted' ? 'text-slate-900' : 'text-slate-500 line-through decoration-slate-300'}`}>{what}</p>
                    {r.status === 'dismissed' && r.reason && <p className="text-sm text-slate-500">Reason: {r.reason}</p>}
                  </div>
                  <div className="md:text-right text-sm">
                    {r.status === 'accepted' &&
                      (res ? (
                        <>
                          <p className="font-medium text-slate-900">
                            Sold <span className="num">{Math.round(res.actual).toLocaleString('en-IN')}</span> a week
                          </p>
                          <p className={res.vs >= 0 ? 'text-shelf' : 'text-act'}>
                            {res.vs >= 0 ? '+' : ''}
                            {res.vs.toFixed(0)}% vs the {Number(r.baseline_weekly).toLocaleString('en-IN')} expected, over {res.weeks} week{res.weeks > 1 ? 's' : ''}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-slate-700">Measuring</p>
                          <p className="text-slate-500">First result after a full week of sales</p>
                        </>
                      ))}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {questions.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-slate-900">Questions you asked</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {questions.map((q) => (
              <li key={q.id}>
                <Link href={`/dashboard/decisions/${q.id}`} className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-slate-50">
                  <span className="truncate text-sm font-medium text-slate-800">{q.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{fmtDay(q.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
