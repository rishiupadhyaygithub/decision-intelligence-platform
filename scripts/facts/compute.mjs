// scripts/facts/compute.mjs
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { computeMlFacts } from './ml.mjs'
import { flagOutliers } from './quality.mjs'
import { scoreHealth, healthSummary } from './health.mjs'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

export function createFactsClient() {
  return createClient(url, key, { auth: { persistSession: false } })
}

const factId = (metric, dims) =>
  'f_' + createHash('sha1').update(metric + JSON.stringify(dims)).digest('hex').slice(0, 16)

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const std = (a) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
const conf = (n) => Math.min(0.95, Math.round((1 - 1 / Math.sqrt(Math.max(n, 1))) * 100) / 100)

async function readView(sb, name) {
  const { data, error } = await sb.from(name).select('*')
  if (error) throw new Error(`${name}: ${error.message}`)
  return data ?? []
}

export async function computeFacts(sb) {
  const facts = []
  const now = new Date().toISOString()
  const push = (metric, dims, value, opts = {}) =>
    facts.push({
      id: factId(metric, dims),
      metric,
      dims,
      value: value == null ? null : Number(value.toFixed(2)),
      value_text: opts.valueText ?? null,
      time_window: opts.window ?? null,
      method: opts.method ?? 'sql',
      sample_n: opts.n ?? null,
      confidence: opts.confidence ?? (opts.n ? conf(opts.n) : null),
      computed_at: now,
    })

  const rev = await readView(sb, 'v_revenue_by_region_daily')
  const byRegion = {}
  for (const r of rev) (byRegion[r.region] ??= []).push(r)
  for (const [region, rows] of Object.entries(byRegion)) {
    rows.sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date))
    const series = rows.map((r) => Number(r.revenue))
    if (series.length < 6) continue
    const recent = series.slice(-4)
    const base = series.slice(0, -4)
    const delta = mean(base) ? ((mean(recent) - mean(base)) / mean(base)) * 100 : 0
    const z = std(base) ? (mean(recent) - mean(base)) / std(base) : 0
    push('revenue_trend_recent', { region }, delta, {
      window: 'recent_vs_base',
      method: 'sql:pct',
      n: series.length,
    })
    push('revenue_anomaly_z', { region }, z, { method: 'sql:zscore', n: series.length })
  }

  for (const m of await readView(sb, 'v_margin')) {
    push('margin_pct', { sku: m.sku_id }, Number(m.margin_pct), {
      method: 'sql',
      n: 1,
      confidence: 0.99,
    })
  }

  const vel = await readView(sb, 'v_sku_velocity')
  const byKey = {}
  for (const v of vel) {
    const k = `${v.sku_id}\0${v.region}`
    ;(byKey[k] ??= []).push(v)
  }
  for (const [k, rows] of Object.entries(byKey)) {
    const sep = k.indexOf('\0')
    const sku = k.slice(0, sep)
    const region = k.slice(sep + 1)
    rows.sort((a, b) => new Date(a.week) - new Date(b.week))
    const u = rows.map((r) => Number(r.units))
    if (u.length < 4) continue
    const last = u[u.length - 1]
    const prior = u.slice(0, -1)
    const delta = mean(prior) ? ((last - mean(prior)) / mean(prior)) * 100 : 0
    push('sku_velocity_delta', { sku, region }, delta, {
      window: 'week',
      method: 'sql:pct',
      n: u.length,
    })
  }

  const inv = await readView(sb, 'v_inventory_risk')
  const latestInv = {}
  for (const r of inv) {
    const k = `${r.sku_id}\0${r.region}`
    if (!latestInv[k] || new Date(r.snapshot_date) > new Date(latestInv[k].snapshot_date))
      latestInv[k] = r
  }
  for (const [k, r] of Object.entries(latestInv)) {
    const sep = k.indexOf('\0')
    const sku = k.slice(0, sep)
    const region = k.slice(sep + 1)
    push('inventory_cover_ratio', { sku, region }, Number(r.cover_ratio), {
      method: 'sql',
      n: 1,
      confidence: 0.9,
      valueText: r.below_reorder ? 'below_reorder' : 'ok',
    })
  }

  for (const c of await readView(sb, 'v_competitor_pressure')) {
    const ratio = c.total_signals ? (c.urgent_signals / c.total_signals) * 100 : 0
    push('competitor_pressure_pct', { category: c.category }, ratio, {
      method: 'rule',
      n: Number(c.total_signals),
    })
  }

  // Merge live ML facts (Holt demand forecast, logreg churn, rule sentiment)
  // into the same pass so they survive the stale-cleanup below.
  const mlFacts = await computeMlFacts(sb)
  facts.push(...mlFacts)

  if (!facts.length) throw new Error('No facts computed — is the seed loaded?')

  // W1 — quality + health pass before persistence.
  const qual = flagOutliers(facts)
  scoreHealth(facts)
  const summary = healthSummary(facts)
  console.log(
    `[quality] flagged ${qual.flagged}/${qual.totalScanned} unstable; ` +
      `[health] mean=${summary.mean} p10=${summary.p10} low=${summary.low_quality}`
  )

  const newIds = new Set(facts.map((f) => f.id))
  const { data: existing, error: listErr } = await sb.from('facts').select('id')
  if (listErr) throw new Error(`facts list: ${listErr.message}`)

  const stale = (existing ?? []).map((r) => r.id).filter((id) => !newIds.has(id))
  if (stale.length) {
    const { error: delErr } = await sb.from('facts').delete().in('id', stale)
    if (delErr) throw new Error(`facts cleanup: ${delErr.message}`)
  }

  const { error } = await sb.from('facts').upsert(facts, { onConflict: 'id' })
  if (error) throw new Error(`facts upsert: ${error.message}`)

  return facts.length
}

import { fileURLToPath } from 'node:url'

async function main() {
  const n = await computeFacts(createFactsClient())
  console.log(`Upserted ${n} facts.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
}
