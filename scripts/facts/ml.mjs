// scripts/facts/ml.mjs
// Live ML fact layer. Faithful JS ports of the offline Python models (ml/*.py),
// runnable with the service-role key already in .env.local — no Python, no
// DATABASE_URL, no paid model. Integrated into compute.mjs so ML facts share the
// single fact-compute pass (compute.mjs deletes any fact not in the fresh set, so
// a separate script would get wiped — these must run inline).
//
// GROUNDING CONTRACT: every value is computed in code from real DB rows.
// Models: Holt linear-trend smoothing (demand), logistic regression (churn),
// rule-based lexical scorer (sentiment). Same metrics/dims/methods as the Python.
import { createHash } from 'node:crypto'

// Must match compute.mjs factId exactly so the table stays consistent.
const factId = (metric, dims) =>
  'f_' + createHash('sha1').update(metric + JSON.stringify(dims)).digest('hex').slice(0, 16)

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const rmse = (a) => Math.sqrt(mean(a.map((x) => x * x)))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

async function readView(sb, name) {
  const { data, error } = await sb.from(name).select('*')
  if (error) throw new Error(`${name}: ${error.message}`)
  return data ?? []
}

// --- Holt linear-trend exponential smoothing (ml:holt) -------------------
// Mirrors statsmodels ExponentialSmoothing(trend="add"), fixed smoothing params.
// Forecast = level + trend; confidence shrinks as residual width grows.
function holtForecast(series, alpha = 0.5, beta = 0.3) {
  if (series.length < 2) return null
  let level = series[0]
  let trend = series[1] - series[0]
  const resid = []
  for (let i = 1; i < series.length; i++) {
    const oneStep = level + trend // fitted value for point i
    resid.push(oneStep - series[i])
    const prevLevel = level
    level = alpha * series[i] + (1 - alpha) * (level + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
  }
  return { fc: level + trend, rstd: rmse(resid) }
}

function forecastFacts(rows) {
  const byRegion = {}
  for (const r of rows) (byRegion[r.region] ??= []).push(r)
  const out = []
  for (const [region, g] of Object.entries(byRegion)) {
    g.sort((a, b) => (String(a.month) < String(b.month) ? -1 : 1))
    const series = g.map((r) => Number(r.units))
    if (series.length < 6) continue // mirror Python n<6 skip
    const h = holtForecast(series)
    if (!h) continue
    const rel = h.fc ? h.rstd / h.fc : 1
    out.push({
      metric: 'demand_forecast_next',
      dims: { region },
      value: Number(h.fc.toFixed(2)),
      window: 'next_month',
      method: 'ml:holt',
      n: series.length,
      confidence: Number(clamp(1 - rel, 0.3, 0.9).toFixed(2)),
    })
  }
  return out
}

// --- Logistic regression (ml:logreg) -------------------------------------
// Batch gradient descent on standardized features. Deterministic (weights init 0).
function trainLogReg(X, y, iters = 3000, lr = 0.3) {
  const n = X.length
  const d = X[0].length
  const mu = Array(d).fill(0)
  const sd = Array(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) mu[j] += row[j] / n
  for (const row of X) for (let j = 0; j < d; j++) sd[j] += (row[j] - mu[j]) ** 2 / n
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]))
  const sig = (z) => 1 / (1 + Math.exp(-z))
  const w = Array(d).fill(0)
  let b = 0
  for (let it = 0; it < iters; it++) {
    const gw = Array(d).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      const p = sig(Z[i].reduce((s, v, j) => s + v * w[j], 0) + b)
      const e = p - y[i]
      for (let j = 0; j < d; j++) gw[j] += (e * Z[i][j]) / n
      gb += e / n
    }
    for (let j = 0; j < d; j++) w[j] -= lr * gw[j]
    b -= lr * gb
  }
  return (x) => {
    const z = x.map((v, j) => (v - mu[j]) / sd[j])
    return sig(z.reduce((s, v, j) => s + v * w[j], 0) + b)
  }
}

function churnFacts(rows) {
  const byKey = {}
  for (const v of rows) (byKey[`${v.sku_id}\0${v.region}`] ??= []).push(v)
  const series = {}
  for (const [k, g] of Object.entries(byKey)) {
    g.sort((a, b) => (String(a.week) < String(b.week) ? -1 : 1))
    series[k] = g.map((r) => Number(r.units))
  }

  // Build training set: features (relative level, relative volatility), label =
  // next week falls >15% below trailing-3 mean. (Mirrors churn.py.)
  const X = []
  const Y = []
  for (const u of Object.values(series)) {
    if (u.length < 6) continue
    for (let i = 3; i < u.length - 1; i++) {
      const trail = u.slice(i - 3, i)
      const m = mean(trail) || 1
      X.push([u[i] / m, rmse(trail.map((x) => x - mean(trail))) / m])
      Y.push(u[i + 1] < m * 0.85 ? 1 : 0)
    }
  }
  if (new Set(Y).size < 2) return [] // not enough label variety to train

  const predict = trainLogReg(X, Y)
  const out = []
  for (const [k, u] of Object.entries(series)) {
    if (u.length < 6) continue
    const sep = k.indexOf('\0')
    const sku = k.slice(0, sep)
    const region = k.slice(sep + 1)
    const trail = u.slice(-4, -1)
    const m = mean(trail) || 1
    const p = predict([u[u.length - 1] / m, rmse(trail.map((x) => x - mean(trail))) / m])
    out.push({
      metric: 'churn_risk',
      dims: { sku, region },
      value: Number(p.toFixed(3)),
      window: 'next_week',
      method: 'ml:logreg',
      n: u.length,
      confidence: 0.7,
    })
  }
  return out
}

// --- Rule-based sentiment (ml:rule) --------------------------------------
const NEG = ['drop', 'down', 'decline', 'loss', 'pressure', 'risk', 'flash sale',
  'stockout', 'squeeze', 'war', 'preempt']
const POS = ['up', 'growth', 'spike', 'win', 'tailwind', 'first-mover', 'viral',
  'opportunity', 'gain']

function sentimentScore(text) {
  const t = String(text).toLowerCase()
  const s = POS.filter((w) => t.includes(w)).length - NEG.filter((w) => t.includes(w)).length
  return clamp(s / 3, -1, 1)
}

function sentimentFacts(rows) {
  const byCat = {}
  for (const r of rows) (byCat[r.category] ??= []).push(r)
  const out = []
  for (const [category, g] of Object.entries(byCat)) {
    const vals = g.map((r) => sentimentScore(r.body))
    const avg = mean(vals)
    out.push({
      metric: 'signal_sentiment',
      dims: { category },
      value: Number(avg.toFixed(2)),
      window: 'current',
      method: 'ml:rule',
      n: vals.length,
      confidence: 0.6,
      valueText: avg < 0 ? 'negative' : 'positive',
    })
  }
  return out
}

// Returns fact rows in the same shape compute.mjs uses, ready to merge before upsert.
export async function computeMlFacts(sb) {
  const now = new Date().toISOString()
  const raw = [
    ...forecastFacts(await readView(sb, 'v_region_demand')),
    ...churnFacts(await readView(sb, 'v_sku_velocity')),
    ...sentimentFacts(await readView(sb, 'competitor_signal')),
  ]
  return raw.map((r) => ({
    id: factId(r.metric, r.dims),
    metric: r.metric,
    dims: r.dims,
    value: r.value ?? null,
    value_text: r.valueText ?? null,
    time_window: r.window ?? null,
    method: r.method,
    sample_n: r.n ?? null,
    confidence: r.confidence ?? null,
    computed_at: now,
  }))
}
