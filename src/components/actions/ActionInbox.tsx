'use client'

// The action inbox: concrete, money-quantified proposals. Each card opens a live
// simulator (same engine as the server, run in the browser), then Accept or Dismiss.
// Decisions are stored per user per week; results are measured from later sales.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import {
  ASSUMPTIONS,
  coverPath,
  demand,
  promoOutcome,
  restockOutcome,
  transferOutcome,
  type Action,
  type SeriesInput,
} from '@/lib/actions/engine'
import CoverChart from './CoverChart'

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const units = (n: number) => Math.round(n).toLocaleString('en-IN')
const TYPE = {
  restock: { label: 'Restock', tone: 'text-act', bar: 'bg-act' },
  transfer: { label: 'Move stock', tone: 'text-indigo-700', bar: 'bg-indigo-600' },
  promote: { label: 'Clear excess', tone: 'text-watch', bar: 'bg-watch' },
} as const
const URGENCY = { now: 'Act today', 'this week': 'This week', soon: 'When convenient' } as const

type Decided = Record<string, { status: 'accepted' | 'dismissed'; id: string }>

export default function ActionInbox({ actions, inputs, week, decided: initial }: { actions: Action[]; inputs: SeriesInput[]; week: string; decided: Decided }) {
  const router = useRouter()
  const [decided, setDecided] = useState<Decided>(initial)
  const [open, setOpen] = useState<string | null>(actions[0]?.key ?? null)
  const [filter, setFilter] = useState<'all' | Action['type']>('all')
  const [error, setError] = useState('')
  const byPair = useMemo(() => new Map(inputs.map((s) => [`${s.sku}|${s.region}`, s])), [inputs])

  const visible = actions.filter((a) => (filter === 'all' || a.type === filter) && decided[a.key]?.status !== 'dismissed')
  const counts = { all: actions.length, restock: 0, transfer: 0, promote: 0 }
  for (const a of actions) counts[a.type]++

  async function decide(a: Action, status: 'accepted' | 'dismissed', extra: { quantity?: number; discount?: number; projected?: object; reason?: string } = {}) {
    setError('')
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('action_decisions')
      .insert({
        action_key: a.key,
        week_start: week,
        type: a.type,
        sku: a.sku,
        region: a.region,
        from_region: a.fromRegion ?? null,
        status,
        quantity: extra.quantity ?? a.quantity,
        discount: extra.discount ?? a.discount ?? null,
        projected: extra.projected ?? { impact: a.impact, coverNow: a.coverNow, coverAfter: a.coverAfter, confidence: a.confidence },
        baseline_weekly: Math.round(a.weeklyDemand),
        reason: extra.reason ?? null,
      })
      .select('id')
      .single()
    if (err) {
      setError(err.message.includes('duplicate') ? 'Already recorded for this week.' : 'Could not save. Check your connection and try again.')
      return
    }
    setDecided((d) => ({ ...d, [a.key]: { status, id: data.id } }))
    if (status === 'accepted') setOpen(null)
    // the totals at the top of the page are server-rendered; recompute them
    router.refresh()
  }

  async function undo(a: Action) {
    const rec = decided[a.key]
    if (!rec) return
    await createClient().from('action_decisions').delete().eq('id', rec.id)
    setDecided((d) => {
      const n = { ...d }
      delete n[a.key]
      return n
    })
    router.refresh()
  }

  if (!actions.length) {
    return (
      <div className="rounded-2xl border border-line bg-white px-6 py-12 text-center">
        <p className="text-lg font-semibold text-slate-900">Nothing to act on this week</p>
        <p className="mt-1 text-sm text-slate-500">Every product has between {ASSUMPTIONS.leadTimeWeeks + ASSUMPTIONS.safetyWeeks} and {ASSUMPTIONS.overstockWeeks} weeks of stock.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter actions">
        {(['all', 'restock', 'transfer', 'promote'] as const).map((f) =>
          f === 'all' || counts[f] ? (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${filter === f ? 'bg-ink text-white' : 'bg-white border border-line text-slate-600 hover:text-slate-900'}`}
            >
              {f === 'all' ? 'All' : TYPE[f].label} <span className="opacity-60">{counts[f]}</span>
            </button>
          ) : null,
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-act">{error}</p>}

      <ol className="mt-4 space-y-3">
        {visible.map((a, i) => {
          const t = TYPE[a.type]
          const isOpen = open === a.key
          const done = decided[a.key]?.status === 'accepted'
          return (
            <li
              key={a.key}
              className={`relative overflow-hidden rounded-2xl border bg-white animate-rise transition-shadow ${isOpen ? 'border-slate-300 shadow-[0_8px_30px_-12px_rgba(18,33,46,0.18)]' : 'border-line'}`}
              style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
            >
              <span className={`absolute left-0 inset-y-0 w-1 ${done ? 'bg-slate-300' : t.bar}`} aria-hidden="true" />
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : a.key)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-6 py-5 text-left"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 text-xs font-semibold">
                    <span className={done ? 'text-slate-400' : t.tone}>{t.label}</span>
                    <span className="text-slate-300" aria-hidden="true">/</span>
                    <span className="text-slate-500 font-medium">{URGENCY[a.urgency]}</span>
                    {done && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Accepted</span>}
                  </span>
                  <span className={`mt-1 block text-[17px] font-semibold leading-snug ${done ? 'text-slate-500' : 'text-slate-900'}`}>{a.title}</span>
                  {!isOpen && <span className="mt-1 block text-sm text-slate-500 line-clamp-1">{a.why}</span>}
                </span>
                <span className="sm:text-right">
                  <span className={`num block text-2xl font-semibold tracking-tight ${done ? 'text-slate-400' : 'text-slate-900'}`}>{money(a.type === 'promote' ? a.impact.value : a.impact.revenue)}</span>
                  <span className="block text-xs text-slate-500">{a.type === 'promote' ? 'cash freed from stock' : 'sales protected'}</span>
                </span>
              </button>

              {isOpen && (
                <Simulator
                  action={a}
                  input={byPair.get(`${a.sku}|${a.region}`)}
                  donor={a.fromRegion ? byPair.get(`${a.sku}|${a.fromRegion}`) : undefined}
                  done={done}
                  onAccept={(extra) => decide(a, 'accepted', extra)}
                  onDismiss={(reason) => decide(a, 'dismissed', { reason })}
                  onUndo={() => undo(a)}
                />
              )}
            </li>
          )
        })}
      </ol>

      {actions.some((a) => decided[a.key]?.status === 'dismissed') && (
        <p className="mt-4 text-sm text-slate-500">
          {actions.filter((a) => decided[a.key]?.status === 'dismissed').length} dismissed this week. They come back if next week&apos;s numbers still call for them.
        </p>
      )}
    </div>
  )
}

function Simulator({
  action: a,
  input,
  donor,
  done,
  onAccept,
  onDismiss,
  onUndo,
}: {
  action: Action
  input?: SeriesInput
  donor?: SeriesInput
  done: boolean
  onAccept: (extra: { quantity?: number; discount?: number; projected?: object }) => void
  onDismiss: (reason: string) => void
  onUndo: () => void
}) {
  const step = ASSUMPTIONS.caseSize
  // A transfer can never take more than the donor's spare stock (what it holds beyond
  // its own target cover); an order can go up to twice the suggestion.
  const maxQty =
    a.type === 'transfer' && donor
      ? Math.max(a.quantity, Math.floor(Math.max(0, donor.onHand - demand(donor).weekly * ASSUMPTIONS.targetCoverWeeks) / step) * step)
      : Math.max(step, Math.ceil((a.quantity * 2) / step) * step)
  const [qty, setQty] = useState(a.quantity)
  const [discount, setDiscount] = useState(a.discount ?? ASSUMPTIONS.promoDiscount)
  const [busy, setBusy] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  if (!input) return <p className="px-6 pb-5 text-sm text-slate-500">The underlying numbers are not available right now.</p>

  const w = a.weeklyDemand
  const sim =
    a.type === 'restock'
      ? (() => {
          const o = restockOutcome(input, w, qty)
          return { revenue: o.revenue, margin: o.margin, cover: o.coverAfter, path: coverPath(input.onHand, w, { week: ASSUMPTIONS.leadTimeWeeks, units: qty }, ASSUMPTIONS.targetCoverWeeks + 1), note: `${units(o.protectedUnits)} units of sales kept that would otherwise be lost` }
        })()
      : a.type === 'transfer'
        ? (() => {
            const o = transferOutcome(input, w, qty)
            return { revenue: o.revenue, margin: o.margin, cover: o.coverAfter, path: coverPath(input.onHand, w, { week: ASSUMPTIONS.transferWeeks, units: qty }, ASSUMPTIONS.targetCoverWeeks + 1), note: `${units(o.protectedUnits)} units kept on shelf, after ${money(qty * ASSUMPTIONS.transferCostPerUnit)} of transfer cost` }
          })()
        : (() => {
            const o = promoOutcome(input, w, discount)
            return { revenue: o.cashFreed, margin: o.margin, cover: o.coverAfter, path: coverPath(input.onHand, w, null, 8, w * ASSUMPTIONS.elasticity * discount), note: `${units(o.extraUnits)} extra units sold over ${Math.ceil(o.weeks)} weeks, ${money(o.revenue)} of extra sales after the discount` }
          })()

  const changed = a.type === 'promote' ? discount !== a.discount : qty !== a.quantity

  return (
    <div className="border-t border-line px-6 py-5">
      <p className="text-sm leading-relaxed text-slate-600 max-w-3xl">{a.why}</p>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
        <div>
          {a.type === 'promote' ? (
            <label className="block">
              <span className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-800">Discount</span>
                <span className="num font-semibold text-slate-900">{Math.round(discount * 100)}%</span>
              </span>
              <input type="range" min={0.05} max={0.25} step={0.01} value={discount} disabled={done} onChange={(e) => setDiscount(Number(e.target.value))} className="mt-2 w-full accent-[#0f7b5f]" />
            </label>
          ) : (
            <label className="block">
              <span className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-800">{a.type === 'transfer' ? `Units to move from ${a.fromRegion}` : 'Units to order'}</span>
                <span className="num font-semibold text-slate-900">{units(qty)}</span>
              </span>
              <input type="range" min={0} max={maxQty} step={step} value={qty} disabled={done} onChange={(e) => setQty(Number(e.target.value))} className="mt-2 w-full accent-[#0f7b5f]" />
              <span className="mt-1 flex justify-between text-xs text-slate-400">
                <span>0</span>
                <span>suggested {units(a.quantity)}</span>
                <span>{units(maxQty)}</span>
              </span>
            </label>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-slate-500">{a.type === 'promote' ? 'Cash freed from stock' : 'Sales protected'}</dt>
              <dd className="num text-xl font-semibold text-slate-900">{money(sim.revenue)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Margin effect</dt>
              <dd className={`num text-xl font-semibold ${sim.margin >= 0 ? 'text-shelf' : 'text-act'}`}>
                {sim.margin >= 0 ? '+' : '−'}
                {money(Math.abs(sim.margin))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Weeks of stock now</dt>
              <dd className="num text-xl font-semibold text-slate-900">{a.coverNow.toFixed(1)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">After this action</dt>
              <dd className="num text-xl font-semibold text-slate-900">{sim.cover.toFixed(1)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">{sim.note}.</p>
        </div>

        <div>
          <p className="text-xs text-slate-500">
            {a.type === 'promote'
              ? 'Units in stock over the next 8 weeks'
              : `Units in stock over the next ${ASSUMPTIONS.targetCoverWeeks + 1} weeks. The order covers ${ASSUMPTIONS.targetCoverWeeks}; the next one is due as stock nears the reorder point.`}
          </p>
          <CoverChart path={sim.path} reorderPoint={input.reorderPoint} />
        </div>
      </div>

      <details className="mt-4 text-sm text-slate-600">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">The numbers behind this</summary>
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {a.evidence.map((e) => (
            <li key={e.label} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">{e.label}</p>
              <p className="font-medium text-slate-800">{e.value}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Assumes resupply in {ASSUMPTIONS.leadTimeWeeks} week, transfers in {ASSUMPTIONS.transferWeeks * 7} days, a target of {ASSUMPTIONS.targetCoverWeeks} weeks of stock
          {a.type === 'promote' ? `, and that each 10% off lifts unit sales about ${Math.round(ASSUMPTIONS.elasticity * 10)}%` : ''}. Forecast confidence {Math.round(a.confidence * 100)}%.
        </p>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {done ? (
          <>
            <p className="text-sm text-slate-600">Accepted. The result is measured from next week&apos;s sales on the Log page.</p>
            <button onClick={onUndo} className="text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900">
              Undo
            </button>
          </>
        ) : dismissing ? (
          <>
            <span className="text-sm text-slate-600">Why not?</span>
            {['Already handled', 'Numbers look wrong', 'Not a priority'].map((r) => (
              <button key={r} onClick={() => onDismiss(r)} className="rounded-full border border-line bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400">
                {r}
              </button>
            ))}
            <button onClick={() => setDismissing(false)} className="text-sm text-slate-500 hover:text-slate-900">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onAccept({
                  quantity: a.type === 'promote' ? Math.round(promoOutcome(input, w, discount).extraUnits) : qty,
                  discount: a.type === 'promote' ? discount : undefined,
                  projected: { impact: { revenue: sim.revenue, margin: sim.margin }, coverNow: a.coverNow, coverAfter: sim.cover, confidence: a.confidence, adjusted: changed },
                })
                setBusy(false)
              }}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60 transition"
            >
              {busy ? 'Saving…' : changed ? 'Accept with changes' : 'Accept'}
            </button>
            <button onClick={() => setDismissing(true)} className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400 transition">
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  )
}
