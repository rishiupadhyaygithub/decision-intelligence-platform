// W3.1 — Driver decomposition.
// Given a target metric series and 1..N candidate driver series (aligned by week),
// fit a small ridge regression, then attribute contribution using
// contribution_i = |beta_i * stddev(driver_i)| / sum(|beta_j * stddev(driver_j)|).
//
// Not causal — correlation-based attribution, honestly labeled as such in the UI.
// Ridge (small lambda) keeps 78-week fits from blowing up when drivers correlate.

export type Series = { week: string; value: number }
export type DriverInput = { name: string; series: Series[]; fact_ids?: string[] }

export interface DriverResult {
  driver: string
  beta: number
  contribution_pct: number
  fact_ids: string[]
}

export interface DecompositionOutput {
  target: string
  n_weeks: number
  r_squared: number
  intercept: number
  drivers: DriverResult[]
  residual_sigma: number
  method: 'ridge_regression'
  lambda: number
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const std = (a: number[]) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}

function alignByWeek(
  target: Series[],
  drivers: DriverInput[],
): { weeks: string[]; y: number[]; X: number[][] } {
  const weekMap = new Map<string, { y: number; xs: (number | null)[] }>()
  for (const t of target) weekMap.set(t.week, { y: t.value, xs: drivers.map(() => null) })

  drivers.forEach((d, i) => {
    for (const s of d.series) {
      const bucket = weekMap.get(s.week)
      if (bucket) bucket.xs[i] = s.value
    }
  })

  const weeks: string[] = []
  const y: number[] = []
  const X: number[][] = []
  for (const [wk, bucket] of Array.from(weekMap.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (bucket.xs.some((v) => v == null)) continue
    weeks.push(wk)
    y.push(bucket.y)
    X.push(bucket.xs as number[])
  }
  return { weeks, y, X }
}

// Solve (X^T X + λI) β = X^T y via Gauss-Jordan. Small k (<10), fine.
function ridge(X: number[][], y: number[], lambda: number): { beta: number[]; intercept: number } {
  const n = X.length
  if (n === 0) return { beta: [], intercept: 0 }
  const k = X[0].length

  const yMean = mean(y)
  const xMeans = Array.from({ length: k }, (_, j) => mean(X.map((row) => row[j])))
  const Xc = X.map((row) => row.map((v, j) => v - xMeans[j]))
  const yc = y.map((v) => v - yMean)

  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  const Xty: number[] = Array(k).fill(0)
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += Xc[i][a] * yc[i]
      for (let b = 0; b < k; b++) XtX[a][b] += Xc[i][a] * Xc[i][b]
    }
  }
  for (let a = 0; a < k; a++) XtX[a][a] += lambda

  // Gauss-Jordan.
  const A: number[][] = XtX.map((row, i) => [...row, Xty[i]])
  for (let i = 0; i < k; i++) {
    let pivot = i
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r
    if (pivot !== i) [A[i], A[pivot]] = [A[pivot], A[i]]
    const p = A[i][i] || 1e-12
    for (let c = 0; c <= k; c++) A[i][c] /= p
    for (let r = 0; r < k; r++) {
      if (r === i) continue
      const f = A[r][i]
      for (let c = 0; c <= k; c++) A[r][c] -= f * A[i][c]
    }
  }
  const beta = A.map((row) => row[k])
  const intercept = yMean - xMeans.reduce((acc, m, j) => acc + m * beta[j], 0)
  return { beta, intercept }
}

export function decompose(
  target: { name: string; series: Series[] },
  drivers: DriverInput[],
  opts: { lambda?: number } = {},
): DecompositionOutput {
  const lambda = opts.lambda ?? 0.05
  const { y, X } = alignByWeek(target.series, drivers)

  if (y.length < Math.max(6, drivers.length + 2) || drivers.length === 0) {
    return {
      target: target.name,
      n_weeks: y.length,
      r_squared: 0,
      intercept: 0,
      drivers: [],
      residual_sigma: 0,
      method: 'ridge_regression',
      lambda,
    }
  }

  const { beta, intercept } = ridge(X, y, lambda)

  const yHat = X.map((row) => intercept + row.reduce((a, v, j) => a + v * beta[j], 0))
  const resid = y.map((v, i) => v - yHat[i])
  const ssRes = resid.reduce((a, r) => a + r * r, 0)
  const yBar = mean(y)
  const ssTot = y.reduce((a, v) => a + (v - yBar) ** 2, 0) || 1
  const r2 = Math.max(0, Math.min(1, 1 - ssRes / ssTot))
  const residualSigma = std(resid)

  const driverStd = drivers.map((_, j) => std(X.map((row) => row[j])))
  const raw = beta.map((b, j) => Math.abs(b * driverStd[j]))
  const totalRaw = raw.reduce((a, v) => a + v, 0) || 1

  const results: DriverResult[] = drivers.map((d, j) => ({
    driver: d.name,
    beta: Number(beta[j].toFixed(4)),
    contribution_pct: Number(((raw[j] / totalRaw) * 100).toFixed(1)),
    fact_ids: d.fact_ids ?? [],
  }))

  results.sort((a, b) => b.contribution_pct - a.contribution_pct)

  return {
    target: target.name,
    n_weeks: y.length,
    r_squared: Number(r2.toFixed(3)),
    intercept: Number(intercept.toFixed(4)),
    drivers: results,
    residual_sigma: Number(residualSigma.toFixed(4)),
    method: 'ridge_regression',
    lambda,
  }
}
