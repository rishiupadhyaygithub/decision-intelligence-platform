import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SyntheticNote } from '@/components/decisionos'
import ActionInbox from '@/components/actions/ActionInbox'
import IssueList from '@/components/brief/IssueList'
import { buildActions } from '@/lib/actions/engine'
import { loadSeries, mondayOf } from '@/lib/actions/load'
import { buildBrief, type FactLike } from '@/lib/brief'

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const fmtDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

export default async function InboxPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const week = mondayOf()
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const [inputs, decRes, monthRes, factsRes, skuRes] = await Promise.all([
    loadSeries(supabase),
    supabase.from('action_decisions').select('id,action_key,status').eq('week_start', week),
    supabase.from('action_decisions').select('status,projected').eq('status', 'accepted').gte('created_at', monthStart),
    supabase.from('facts').select('id,metric,dims,value,sample_n'),
    supabase.from('sku').select('sku_id,name'),
  ])

  const actions = buildActions(inputs)
  const decided = Object.fromEntries((decRes.data ?? []).map((d) => [d.action_key, { status: d.status as 'accepted' | 'dismissed', id: d.id }]))
  const open = actions.filter((a) => !decided[a.key])
  const atRisk = open.filter((a) => a.type !== 'promote').reduce((s, a) => s + a.impact.revenue, 0)
  const cashTied = open.filter((a) => a.type === 'promote').reduce((s, a) => s + a.impact.value, 0)
  const accepted = monthRes.data ?? []
  const acceptedValue = accepted.reduce((s, d) => s + Number((d.projected as { impact?: { revenue?: number } })?.impact?.revenue ?? 0), 0)

  // Secondary: sales and revenue movements worth knowing that are not stock actions.
  const skuNames = Object.fromEntries((skuRes.data ?? []).map((s) => [s.sku_id, s.name]))
  const signals = buildBrief((factsRes.data ?? []) as FactLike[], skuNames).filter((i) => !i.key.startsWith('stock:')).slice(0, 4)

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8 py-8 lg:py-12">
      <header>
        <p className="text-sm text-slate-500">Week of {fmtDay(week)}</p>
        <h1 className="mt-1 text-3xl sm:text-[40px] font-semibold leading-tight tracking-tight text-slate-900">
          {open.length ? `${open.length} action${open.length > 1 ? 's' : ''} ready for you` : 'You are up to date'}
        </h1>
        <SyntheticNote />
      </header>

      <section aria-label="This week in numbers" className="mt-6 grid grid-cols-1 sm:grid-cols-3 overflow-hidden rounded-2xl border border-line bg-white divide-y sm:divide-y-0 sm:divide-x divide-line">
        <div className="px-6 py-5">
          <p className="num text-3xl font-semibold tracking-tight text-act">{money(atRisk)}</p>
          <p className="mt-1 text-sm text-slate-600">of sales at risk from low stock</p>
        </div>
        <div className="px-6 py-5">
          <p className="num text-3xl font-semibold tracking-tight text-watch">{money(cashTied)}</p>
          <p className="mt-1 text-sm text-slate-600">of cash that could be freed from excess stock</p>
        </div>
        <div className="px-6 py-5">
          <p className="num text-3xl font-semibold tracking-tight text-shelf">{money(acceptedValue)}</p>
          <p className="mt-1 text-sm text-slate-600">
            of sales protected or cash freed by the {accepted.length} action{accepted.length === 1 ? '' : 's'} you accepted this month.{' '}
            <Link href="/dashboard/log" className="text-indigo-700 underline decoration-indigo-200 underline-offset-2">
              See results
            </Link>
          </p>
        </div>
      </section>

      <section className="mt-8" aria-label="Actions">
        <ActionInbox actions={actions} inputs={inputs} week={week} decided={decided} />
      </section>

      {signals.length > 0 && (
        <section className="mt-12" aria-labelledby="signals">
          <div className="flex items-baseline justify-between">
            <h2 id="signals" className="text-lg font-semibold text-slate-900">Also worth knowing</h2>
            <Link href="/dashboard/new-decision" className="text-sm text-indigo-700 hover:underline">
              Ask about anything
            </Link>
          </div>
          <p className="mt-1 text-sm text-slate-500">Movements in sales and revenue that do not need a stock decision yet.</p>
          <div className="mt-4">
            <IssueList issues={signals} series={{}} />
          </div>
        </section>
      )}
    </main>
  )
}
