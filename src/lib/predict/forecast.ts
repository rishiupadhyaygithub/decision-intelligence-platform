// W4.1 — In-process forecast (TS-native).
// Decision: skip FastAPI service. Python trainer still runs offline via
// scripts/facts/ml.mjs to populate ml facts; this module produces on-demand
// forecasts + P10/P50/P90 bands from live series so the UI stays snappy.
//
// Model: Simple Exponential Smoothing with damped additive trend.
// Bands: residual bootstrap (nonparametric) — no gaussian assumption.

export type Series = { week: string; value: number }

export interface ForecastPoint {
  week: string
  p10: number
  p50: number
  p90: number
}

export interface ForecastOutput {
  method: 'des_bootstrap'
  horizon: number
  fitted: number[]
  residual_sigma: number
  cv: number
  point: ForecastPoint[]
  alpha: number
  beta: number
  phi: number
  n_train: number
}

function desDamped(y: number[], alpha: number, beta: number, phi: number) {
  if (y.length === 0) return { level: [], trend: [], fitted: [] as number[] }
  const level = [y[0]]
  const trend = [y.length > 1 ? y[1] - y[0] : 0]
  const fitted: number[] = [y[0]]
  for (let t = 1; t < y.length; t++) {
    const lPrev = level[t - 1]
    const bPrev = trend[t - 1]
    const yhat = lPrev + phi * bPrev
    fitted.push(yhat)
    const lNew = alpha * y[t] + (1 - alpha) * yhat
    const bNew = beta * (lNew - lPrev) + (1 - beta) * phi * bPrev
    level.push(lNew)
    trend.push(bNew)
  }
  return { level, trend, fitted }
}

function sse(y: number[], fitted: number[]) {
  let s = 0
  for (let i = 1; i < y.length; i++) s += (y[i] - fitted[i]) ** 2
  return s
}

// Coarse grid search on (α, β, φ). k ≤ 5 × 5 × 3 = 75 fits — cheap on ≤80 pts.
function gridFit(y: number[]) {
  const alphas = [0.2, 0.4, 0.6, 0.8]
  const betas = [0.05, 0.15, 0.3]
  const phis = [0.85, 0.95, 1.0]
  let best = { alpha: 0.4, beta: 0.1, phi: 0.95, sse: Infinity }
  for (const a of alphas) {
    for (const b of betas) {
      for (const p of phis) {
        const { fitted } = desDamped(y, a, b, p)
        const err = sse(y, fitted)
        if (err < best.sse) best = { alpha: a, beta: b, phi: p, sse: err }
      }
    }
  }
  return best
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] != null
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

// Bootstrap: resample residuals to build simulated futures, then take quantiles.
function bootstrapBands(
  y: number[],
  fitted: number[],
  alpha: number,
  beta: number,
  phi: number,
  horizon: number,
  runs = 400,
): ForecastPoint['p10'][][] {
  const resid: number[] = []
  for (let i = 1; i < y.length; i++) resid.push(y[i] - fitted[i])
  if (resid.length === 0) return Array.from({ length: horizon }, () => [0])

  const paths: number[][] = []
  for (let r = 0; r < runs; r++) {
    const { level, trend } = desDamped(y, alpha, beta, phi)
    let lPrev = level[level.length - 1]
    let bPrev = trend[trend.length - 1]
    const p: number[] = []
    for (let h = 1; h <= horizon; h++) {
      const eps = resid[Math.floor(Math.random() * resid.length)]
      const point = lPrev + phi * bPrev + eps
      p.push(point)
      const yObs = point
      const lNew = alpha * yObs + (1 - alpha) * (lPrev + phi * bPrev)
      const bNew = beta * (lNew - lPrev) + (1 - beta) * phi * bPrev
      lPrev = lNew
      bPrev = bNew
    }
    paths.push(p)
  }
  const byStep: number[][] = Array.from({ length: horizon }, (_, i) =>
    paths.map((p) => p[i]).sort((a, b) => a - b),
  )
  return byStep
}

function addWeeks(iso: string, n: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

export function forecast(series: Series[], horizon = 4): ForecastOutput {
  const sorted = [...series].sort((a, b) => a.week.localeCompare(b.week))
  const y = sorted.map((s) => s.value).filter((v) => Number.isFinite(v))
  if (y.length < 6 || horizon <= 0) {
    return {
      method: 'des_bootstrap',
      horizon,
      fitted: [],
      residual_sigma: 0,
      cv: 1,
      point: [],
      alpha: 0,
      beta: 0,
      phi: 0,
      n_train: y.length,
    }
  }

  const best = gridFit(y)
  const { fitted } = desDamped(y, best.alpha, best.beta, best.phi)

  const residuals: number[] = []
  for (let i = 1; i < y.length; i++) residuals.push(y[i] - fitted[i])
  const rMean = residuals.reduce((a, b) => a + b, 0) / (residuals.length || 1)
  const rSigma = Math.sqrt(
    residuals.reduce((a, r) => a + (r - rMean) ** 2, 0) / (residuals.length || 1),
  )

  const bands = bootstrapBands(y, fitted, best.alpha, best.beta, best.phi, horizon)
  const lastWeek = sorted[sorted.length - 1].week
  const yMean = y.reduce((a, b) => a + b, 0) / y.length
  const cv = yMean !== 0 ? rSigma / Math.abs(yMean) : 1

  return {
    method: 'des_bootstrap',
    horizon,
    fitted: fitted.map((v) => Number(v.toFixed(3))),
    residual_sigma: Number(rSigma.toFixed(3)),
    cv: Number(cv.toFixed(3)),
    point: bands.map((step, i) => ({
      week: addWeeks(lastWeek, i + 1),
      p10: Number(quantile(step, 0.1).toFixed(3)),
      p50: Number(quantile(step, 0.5).toFixed(3)),
      p90: Number(quantile(step, 0.9).toFixed(3)),
    })),
    alpha: best.alpha,
    beta: best.beta,
    phi: best.phi,
    n_train: y.length,
  }
}
