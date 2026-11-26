// The weekly brief: turns computed facts into a short, ranked list of things that need
// a decision, in plain language, each carrying the fact ids that back it.
// Pure and dependency-free so it is unit-tested directly (node --test).
//
// Metric meanings (see supabase/migrations/0002 + 0011 views):
//   inventory_cover_ratio  on_hand / reorder_point at the latest month-end snapshot (<1 = below reorder point)
//   sku_velocity_delta     last week's units vs the average of earlier weeks, %
//   revenue_trend_recent   last 4 weeks of revenue vs the earlier base, % (per region)
//   churn_risk             model probability that next week's units fall >15% below the trailing mean
//   competitor_pressure_pct share of a signal category flagged urgent, %

export type Tone = 'act' | 'watch' | 'good'

export interface FactLike {
  id: string
  metric: string
  dims: Record<string, string | number>
  value: number | null
  sample_n?: number | null
}

export interface Issue {
  key: string
  tone: Tone
  headline: string
  detail: string
  figure: string
  figureLabel: string
  sku?: string
  region?: string
  factIds: string[]
  decide: { title: string; proposal: string }
  score: number
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`
const TONE_RANK: Record<Tone, number> = { act: 3, watch: 2, good: 1 }

export function buildBrief(facts: FactLike[], skuNames: Record<string, string> = {}): Issue[] {
  const name = (sku: string) => skuNames[sku] ?? sku
  const by = (metric: string) => facts.filter((f) => f.metric === metric && f.value != null)
  const key = (f: FactLike) => `${f.dims.sku ?? ''}|${f.dims.region ?? ''}`
  const velocity = new Map(by('sku_velocity_delta').map((f) => [key(f), f]))
  const issues: Issue[] = []

  for (const f of by('inventory_cover_ratio')) {
    const sku = String(f.dims.sku)
    const region = String(f.dims.region)
    const cover = Number(f.value)
    const vel = velocity.get(key(f))
    const rising = vel && Number(vel.value) > 10
    if (cover < 1) {
      issues.push({
        key: `stock:${key(f)}`,
        tone: 'act',
        headline: `${name(sku)} in ${region} is below its reorder point`,
        detail: rising
          ? `Stock is at ${cover.toFixed(2)}× the reorder level while weekly sales are up ${pct(Number(vel!.value))}. Stockout risk is rising.`
          : `Stock is at ${cover.toFixed(2)}× the reorder level at the latest month-end count.`,
        figure: `${cover.toFixed(2)}×`,
        figureLabel: 'of reorder level',
        sku,
        region,
        factIds: rising ? [f.id, vel!.id] : [f.id],
        decide: {
          title: `Restock ${sku} in ${region}`,
          proposal: `${name(sku)} (${sku}) in ${region} is below its reorder point (cover ${cover.toFixed(2)}×${rising ? `, weekly sales ${pct(Number(vel!.value))}` : ''}). Should we expedite a replenishment order?`,
        },
        score: 100 + (1 - cover) * 50 + (rising ? 20 : 0),
      })
    } else if (cover < 1.2) {
      issues.push({
        key: `stock:${key(f)}`,
        tone: 'watch',
        headline: `${name(sku)} in ${region} is close to its reorder point`,
        detail: `Stock is at ${cover.toFixed(2)}× the reorder level.`,
        figure: `${cover.toFixed(2)}×`,
        figureLabel: 'of reorder level',
        sku,
        region,
        factIds: [f.id],
        decide: {
          title: `Plan replenishment for ${sku} in ${region}`,
          proposal: `${name(sku)} (${sku}) in ${region} is near its reorder point (cover ${cover.toFixed(2)}×). Should we schedule replenishment now?`,
        },
        score: 60 + (1.2 - cover) * 50,
      })
    }
  }

  for (const f of by('sku_velocity_delta')) {
    const sku = String(f.dims.sku)
    const region = String(f.dims.region)
    const d = Number(f.value)
    if (d <= -10) {
      issues.push({
        key: `velocity:${key(f)}`,
        tone: d <= -20 ? 'act' : 'watch',
        headline: `Sales of ${name(sku)} in ${region} dropped ${Math.abs(d).toFixed(0)}% last week`,
        detail: `Last week's units vs the average of earlier weeks.`,
        figure: pct(d),
        figureLabel: 'weekly units',
        sku,
        region,
        factIds: [f.id],
        decide: {
          title: `Respond to falling sales of ${sku} in ${region}`,
          proposal: `Weekly units of ${name(sku)} (${sku}) in ${region} fell ${Math.abs(d).toFixed(1)}% vs its average. What should we do: promotion, price, distribution, or wait?`,
        },
        score: 70 + Math.abs(d),
      })
    } else if (d >= 25) {
      issues.push({
        key: `velocity:${key(f)}`,
        tone: 'watch',
        headline: `Demand for ${name(sku)} in ${region} jumped ${d.toFixed(0)}%`,
        detail: `Last week's units vs the average of earlier weeks. Check that supply keeps up.`,
        figure: pct(d),
        figureLabel: 'weekly units',
        sku,
        region,
        factIds: [f.id],
        decide: {
          title: `Capture the demand spike for ${sku} in ${region}`,
          proposal: `Weekly units of ${name(sku)} (${sku}) in ${region} rose ${d.toFixed(1)}% vs its average. Should we raise supply or adjust price?`,
        },
        score: 50 + d / 2,
      })
    }
  }

  for (const f of by('churn_risk')) {
    const p = Number(f.value)
    if (p < 0.3) continue
    const sku = String(f.dims.sku)
    const region = String(f.dims.region)
    issues.push({
      key: `churn:${key(f)}`,
      tone: p >= 0.5 ? 'act' : 'watch',
      headline: `${name(sku)} in ${region} is likely to lose momentum next week`,
      detail: `The trend model gives a ${(p * 100).toFixed(0)}% chance that next week's units fall more than 15% below the recent average.`,
      figure: `${(p * 100).toFixed(0)}%`,
      figureLabel: 'chance of a drop',
      sku,
      region,
      factIds: [f.id],
      decide: {
        title: `Protect ${sku} in ${region} from a sales dip`,
        proposal: `The model puts a ${(p * 100).toFixed(0)}% chance on a >15% drop in next week's units for ${name(sku)} (${sku}) in ${region}. What should we do?`,
      },
      score: 55 + p * 40,
    })
  }

  for (const f of by('revenue_trend_recent')) {
    const region = String(f.dims.region)
    const d = Number(f.value)
    if (Math.abs(d) < 8) continue
    const up = d > 0
    issues.push({
      key: `revenue:${region}`,
      tone: up ? 'good' : 'watch',
      headline: up ? `Revenue in ${region} is up ${d.toFixed(0)}% over the last 4 weeks` : `Revenue in ${region} is down ${Math.abs(d).toFixed(0)}% over the last 4 weeks`,
      detail: `Last 4 weeks vs the earlier average for the region.`,
      figure: pct(d),
      figureLabel: '4-week revenue',
      region,
      factIds: [f.id],
      decide: {
        title: up ? `Double down on ${region}` : `Reverse the revenue decline in ${region}`,
        proposal: up
          ? `Revenue in ${region} is up ${d.toFixed(1)}% over the last 4 weeks. Should we invest more there (stock, promotion, distribution)?`
          : `Revenue in ${region} is down ${Math.abs(d).toFixed(1)}% over the last 4 weeks. What is driving it and what should we do?`,
      },
      score: (up ? 20 : 45) + Math.abs(d),
    })
  }

  for (const f of by('competitor_pressure_pct')) {
    const p = Number(f.value)
    // A percentage of two or three signals is noise, not pressure.
    if (p < 50 || (f.sample_n ?? 0) < 5) continue
    const category = String(f.dims.category)
    issues.push({
      key: `competitor:${category}`,
      tone: 'watch',
      headline: `${p.toFixed(0)}% of ${category.toLowerCase()} signals are urgent`,
      // sample size shown so the percentage can be judged
      detail: `${f.sample_n} recent ${category.toLowerCase()} signals, share flagged urgent.`,
      figure: `${p.toFixed(0)}%`,
      figureLabel: 'urgent signals',
      factIds: [f.id],
      decide: {
        title: `Respond to ${category.toLowerCase()} pressure`,
        proposal: `${p.toFixed(0)}% of recent ${category.toLowerCase()} signals are urgent. How should we respond?`,
      },
      score: 40 + p / 4,
    })
  }

  return issues.sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone] || b.score - a.score)
}

// "1.2M", "84.5k", "912" — compact figures for axes and labels, currency-neutral.
export function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e7) return `${(n / 1e6).toFixed(0)}M`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(n / 1e3).toFixed(0)}k`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}
