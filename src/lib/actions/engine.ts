// Action engine: turns each product-region's sales, stock and margin into concrete,
// money-quantified actions a person can accept, adjust or dismiss.
//
// Everything here is plain arithmetic on the team's own numbers plus a small set of
// explicit, user-visible assumptions (ASSUMPTIONS). No model invents an impact figure.
// Pure and dependency-light so the same code runs on the server (the inbox) and in the
// browser (live simulation), and is unit-tested directly with node --test.

import { expectedNext, type Series } from '../predict/forecast.ts'

export interface SeriesInput {
  sku: string
  name: string
  region: string
  /** weekly units, oldest -> newest (Mondays) */
  weeks: { week: string; units: number }[]
  /** realised revenue per unit over recent weeks */
  unitPrice: number
  unitCost: number
  /** stock at the latest count */
  onHand: number
  reorderPoint: number
  stockAsOf: string
}

export interface Assumptions {
  leadTimeWeeks: number
  transferWeeks: number
  safetyWeeks: number
  targetCoverWeeks: number
  overstockWeeks: number
  elasticity: number
  promoDiscount: number
  transferCostPerUnit: number
  caseSize: number
}

export const ASSUMPTIONS: Readonly<Assumptions> = {
  leadTimeWeeks: 1, // supplier replenishment arrives in about a week
  transferWeeks: 0.5, // moving stock between regions takes a few days
  safetyWeeks: 1, // buffer kept on top of lead-time demand
  targetCoverWeeks: 4, // restock / transfer up to four weeks of demand
  overstockWeeks: 7, // more than this is cash tied up
  elasticity: 1.8, // 10% off lifts unit sales ~18% (typical FMCG range 1.5-2.5)
  promoDiscount: 0.1,
  transferCostPerUnit: 2,
  caseSize: 12,
}

export type ActionType = 'restock' | 'transfer' | 'promote'

export interface Action {
  key: string
  type: ActionType
  sku: string
  name: string
  region: string
  fromRegion?: string
  title: string
  why: string
  quantity: number
  /** price cut, promote only */
  discount?: number
  impact: { value: number; revenue: number; label: string }
  urgency: 'now' | 'this week' | 'soon'
  confidence: number
  weeklyDemand: number
  coverNow: number
  coverAfter: number
  evidence: { label: string; value: string }[]
}

const round = (n: number, step = 1) => Math.round(n / step) * step
const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const units = (n: number) => Math.round(n).toLocaleString('en-IN')

/** Expected weekly demand (next 4 weeks) and how much to trust it. */
export function demand(s: SeriesInput): { weekly: number; confidence: number } {
  const series: Series[] = s.weeks.map((w) => ({ week: w.week, value: w.units }))
  const recent = s.weeks.slice(-4).map((w) => w.units)
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  if (series.length < 6) return { weekly: recentAvg, confidence: 0.4 }
  // Deterministic: the same data must always give the same quantities.
  const f = expectedNext(series, 4)
  const p50 = f.values.length ? f.values.reduce((a, v) => a + v, 0) / f.values.length : recentAvg
  // Trust falls with noisy history (cv) and rises when the model beat a naive guess.
  const confidence = clamp(0.9 - f.cv * 1.5 + Math.max(0, f.skill ?? 0) * 0.2, 0.35, 0.95)
  return { weekly: Math.max(0, p50), confidence: Number(confidence.toFixed(2)) }
}

// --- Restock --------------------------------------------------------------------

export interface RestockOutcome {
  quantity: number
  protectedUnits: number
  revenue: number
  margin: number
  coverAfter: number
}

/** Units sold that would otherwise be lost to a stockout, over the planning horizon. */
export function restockOutcome(s: SeriesInput, weekly: number, quantity: number, a: Assumptions = ASSUMPTIONS): RestockOutcome {
  const horizon = a.targetCoverWeeks
  // Demand during the lead time can only be met from stock on hand.
  const lostDuringLead = Math.max(0, weekly * a.leadTimeWeeks - s.onHand)
  const lostWithout = Math.max(0, weekly * horizon - s.onHand)
  const lostWith = Math.max(lostDuringLead, weekly * horizon - s.onHand - quantity)
  const protectedUnits = Math.max(0, lostWithout - lostWith)
  return {
    quantity,
    protectedUnits,
    revenue: protectedUnits * s.unitPrice,
    margin: protectedUnits * (s.unitPrice - s.unitCost),
    coverAfter: weekly ? (s.onHand + quantity) / weekly : 0,
  }
}

function restockAction(s: SeriesInput, weekly: number, confidence: number, a: Assumptions): Action | null {
  if (weekly <= 0) return null
  const cover = s.onHand / weekly
  if (cover >= a.leadTimeWeeks + a.safetyWeeks) return null
  const quantity = ceilTo(Math.max(0, weekly * a.targetCoverWeeks - s.onHand), a.caseSize)
  const out = restockOutcome(s, weekly, quantity, a)
  if (out.protectedUnits <= 0) return null
  return {
    key: `restock:${s.sku}:${s.region}`,
    type: 'restock',
    sku: s.sku,
    name: s.name,
    region: s.region,
    title: `Order ${units(quantity)} units of ${s.name} for ${s.region}`,
    why: `Stock covers about ${cover.toFixed(1)} weeks at the current pace of ${units(weekly)} a week, and resupply takes about ${a.leadTimeWeeks} week. Without an order it runs out in roughly ${Math.max(0, cover * 7).toFixed(0)} days.`,
    quantity,
    impact: { value: out.margin, revenue: out.revenue, label: `protects ${money(out.revenue)} of sales` },
    urgency: cover < a.leadTimeWeeks ? 'now' : 'this week',
    confidence,
    weeklyDemand: weekly,
    coverNow: cover,
    coverAfter: out.coverAfter,
    evidence: [
      { label: 'Stock at last count', value: `${units(s.onHand)} units (${s.stockAsOf})` },
      { label: 'Expected weekly sales', value: `${units(weekly)} units` },
      { label: 'Margin per unit', value: money(s.unitPrice - s.unitCost) },
    ],
  }
}

// --- Promote (overstock) ------------------------------------------------------------

export interface PromoOutcome {
  discount: number
  weeks: number
  extraUnits: number
  revenue: number
  margin: number
  cashFreed: number
  coverAfter: number
}

export function promoOutcome(s: SeriesInput, weekly: number, discount: number, a: Assumptions = ASSUMPTIONS): PromoOutcome {
  const excess = Math.max(0, s.onHand - weekly * a.targetCoverWeeks)
  const lift = a.elasticity * discount // share of extra units per week
  const extraPerWeek = weekly * lift
  const weeks = extraPerWeek > 0 ? clamp(excess / extraPerWeek, 1, 8) : 0
  const extraUnits = Math.min(excess, extraPerWeek * weeks)
  const promoPrice = s.unitPrice * (1 - discount)
  // Extra margin on new units minus the discount given away on units that sell anyway.
  const margin = extraUnits * (promoPrice - s.unitCost) - weekly * weeks * s.unitPrice * discount
  return {
    discount,
    weeks,
    extraUnits,
    revenue: extraUnits * promoPrice - weekly * weeks * s.unitPrice * discount,
    margin,
    cashFreed: extraUnits * s.unitCost,
    coverAfter: weekly ? (s.onHand - extraUnits) / weekly : 0,
  }
}

function promoteAction(s: SeriesInput, weekly: number, confidence: number, a: Assumptions): Action | null {
  if (weekly <= 0) return null
  const cover = s.onHand / weekly
  if (cover <= a.overstockWeeks) return null
  const out = promoOutcome(s, weekly, a.promoDiscount, a)
  // Only worth proposing when the cash it frees outweighs the margin it gives up.
  if (out.extraUnits <= 0 || out.cashFreed <= Math.max(0, -out.margin)) return null
  return {
    key: `promote:${s.sku}:${s.region}`,
    type: 'promote',
    sku: s.sku,
    name: s.name,
    region: s.region,
    title: `Run ${Math.round(a.promoDiscount * 100)}% off ${s.name} in ${s.region} for ${Math.ceil(out.weeks)} weeks`,
    why: `There are ${cover.toFixed(1)} weeks of stock against ${units(weekly)} sales a week, so ${money(s.onHand * s.unitCost)} is tied up on the shelf. A short promotion turns ${money(out.cashFreed)} of that back into cash${out.margin < 0 ? `, at a cost of ${money(-out.margin)} in margin` : ' and adds margin'}.`,
    quantity: Math.round(out.extraUnits),
    discount: a.promoDiscount,
    impact: { value: out.cashFreed, revenue: out.revenue, label: `frees ${money(out.cashFreed)} of cash` },
    urgency: 'soon',
    confidence: Number((confidence * 0.85).toFixed(2)), // price response is an assumption
    weeklyDemand: weekly,
    coverNow: cover,
    coverAfter: out.coverAfter,
    evidence: [
      { label: 'Stock at last count', value: `${units(s.onHand)} units (${s.stockAsOf})` },
      { label: 'Expected weekly sales', value: `${units(weekly)} units` },
      { label: 'Margin effect of the promotion', value: `${out.margin >= 0 ? '+' : '−'}${money(Math.abs(out.margin))}` },
    ],
  }
}

// --- Transfer (one region short, another long, same product) -----------------------

export function transferOutcome(to: SeriesInput, toWeekly: number, quantity: number, a: Assumptions = ASSUMPTIONS) {
  // Same arithmetic as a restock, but stock arrives within the transfer time.
  const fast = { ...a, leadTimeWeeks: a.transferWeeks }
  const r = restockOutcome(to, toWeekly, quantity, fast)
  return { ...r, margin: r.margin - quantity * a.transferCostPerUnit }
}

export function buildActions(inputs: SeriesInput[], a: Assumptions = ASSUMPTIONS): Action[] {
  const d = new Map(inputs.map((s) => [`${s.sku}|${s.region}`, demand(s)]))
  const actions: Action[] = []
  const restocks = new Map<string, Action>()

  for (const s of inputs) {
    const { weekly, confidence } = d.get(`${s.sku}|${s.region}`)!
    const r = restockAction(s, weekly, confidence, a)
    if (r) restocks.set(`${s.sku}|${s.region}`, r)
  }

  // A short region with a long sister region gets a transfer first: faster and cheaper.
  for (const [k, r] of restocks) {
    const to = inputs.find((s) => `${s.sku}|${s.region}` === k)!
    const donors = inputs
      .filter((s) => s.sku === to.sku && s.region !== to.region)
      .map((s) => {
        const w = d.get(`${s.sku}|${s.region}`)!.weekly
        return { s, spare: Math.max(0, s.onHand - w * a.targetCoverWeeks) }
      })
      .filter((x) => x.spare >= a.caseSize)
      .sort((x, y) => y.spare - x.spare)
    const donor = donors[0]
    if (!donor) continue
    const qty = Math.min(r.quantity, round(donor.spare, a.caseSize))
    const toWeekly = d.get(k)!.weekly
    const out = transferOutcome(to, toWeekly, qty, a)
    if (out.margin <= 0) continue
    actions.push({
      key: `transfer:${to.sku}:${donor.s.region}:${to.region}`,
      type: 'transfer',
      sku: to.sku,
      name: to.name,
      region: to.region,
      fromRegion: donor.s.region,
      title: `Move ${units(qty)} units of ${to.name} from ${donor.s.region} to ${to.region}`,
      why: `${to.region} has about ${r.coverNow.toFixed(1)} weeks of stock while ${donor.s.region} holds ${units(donor.spare)} units more than it needs. Moving stock arrives faster than a new order.`,
      quantity: qty,
      impact: { value: out.margin, revenue: out.revenue, label: `protects ${money(out.revenue)} of sales` },
      urgency: r.urgency,
      confidence: r.confidence,
      weeklyDemand: toWeekly,
      coverNow: r.coverNow,
      coverAfter: out.coverAfter,
      evidence: [
        { label: `Stock in ${to.region}`, value: `${units(to.onHand)} units` },
        { label: `Spare stock in ${donor.s.region}`, value: `${units(donor.spare)} units` },
        { label: 'Transfer cost', value: money(qty * a.transferCostPerUnit) },
      ],
    })
    // Any remaining shortfall still needs an order.
    const remaining = ceilTo(Math.max(0, r.quantity - qty), a.caseSize)
    if (remaining >= a.caseSize) {
      const rest = restockOutcome({ ...to, onHand: to.onHand + qty }, toWeekly, remaining, a)
      restocks.set(k, { ...r, quantity: remaining, title: `Order ${units(remaining)} more units of ${to.name} for ${to.region}`, impact: { value: rest.margin, revenue: rest.revenue, label: `protects ${money(rest.revenue)} of sales` } })
      if (rest.protectedUnits <= 0) restocks.delete(k)
    } else restocks.delete(k)
  }

  actions.push(...restocks.values())
  for (const s of inputs) {
    const { weekly, confidence } = d.get(`${s.sku}|${s.region}`)!
    const p = promoteAction(s, weekly, confidence, a)
    if (p) actions.push(p)
  }

  const URG = { now: 3, 'this week': 2, soon: 1 }
  return actions.sort((x, y) => URG[y.urgency] - URG[x.urgency] || y.impact.revenue - x.impact.revenue)
}

/** Weeks of cover over the next `weeks` weeks, with and without an action. */
export function coverPath(onHand: number, weekly: number, arrival: { week: number; units: number } | null, weeks = 8, extraWeeklySales = 0) {
  const out: { week: number; without: number; with: number }[] = []
  let a = onHand
  let b = onHand
  for (let w = 0; w <= weeks; w++) {
    out.push({ week: w, without: Math.max(0, a), with: Math.max(0, b) })
    a -= weekly
    b -= weekly + extraWeeklySales
    if (arrival && w + 1 === Math.ceil(arrival.week)) b += arrival.units
  }
  return out
}
