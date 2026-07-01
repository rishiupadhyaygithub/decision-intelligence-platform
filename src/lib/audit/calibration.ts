// W7.2 — Calibration + hit-rate math.
// A prediction "hits" when actual is within tolerance of predicted (default 20%).
// Calibration: bin decisions by confidence quartile, hit rate within bin.
// A well-calibrated system has hit-rate ≈ confidence at every bin.

export interface Outcome {
  decision_id: string
  metric: string
  predicted: number | null
  actual: number | null
  confidence: number | null  // 0..100
}

export interface CalibrationBin {
  band: 'low' | 'medium' | 'high'
  n: number
  avg_confidence: number
  hit_rate: number
  gap: number                // hit_rate - avg_confidence (negative = overconfident)
}

export interface CalibrationOutput {
  n_total: number
  n_measured: number
  overall_hit_rate: number
  bins: CalibrationBin[]
  brier_score: number        // mean((confidence/100 - hit)^2), lower = better
}

function isHit(pred: number, actual: number, tol = 0.2): boolean {
  if (pred === 0) return Math.abs(actual) < tol
  return Math.abs(actual - pred) / Math.abs(pred) <= tol
}

function band(c: number): CalibrationBin['band'] {
  if (c >= 66) return 'high'
  if (c >= 33) return 'medium'
  return 'low'
}

export function computeCalibration(outcomes: Outcome[]): CalibrationOutput {
  const measured = outcomes.filter(
    (o) => o.predicted != null && o.actual != null && o.confidence != null,
  )
  const n = measured.length
  if (n === 0) {
    return {
      n_total: outcomes.length,
      n_measured: 0,
      overall_hit_rate: 0,
      bins: [],
      brier_score: 0,
    }
  }

  const buckets: Record<CalibrationBin['band'], { hits: number; conf: number[]; n: number }> = {
    low: { hits: 0, conf: [], n: 0 },
    medium: { hits: 0, conf: [], n: 0 },
    high: { hits: 0, conf: [], n: 0 },
  }

  let hits = 0
  let brier = 0
  for (const o of measured) {
    const hit = isHit(o.predicted!, o.actual!)
    if (hit) hits += 1
    const c = o.confidence! / 100
    brier += (c - (hit ? 1 : 0)) ** 2
    const b = band(o.confidence!)
    buckets[b].hits += hit ? 1 : 0
    buckets[b].n += 1
    buckets[b].conf.push(c)
  }

  const bins: CalibrationBin[] = (['low', 'medium', 'high'] as const)
    .filter((b) => buckets[b].n > 0)
    .map((b) => {
      const bucket = buckets[b]
      const avg = bucket.conf.reduce((a, x) => a + x, 0) / bucket.n
      const hr = bucket.hits / bucket.n
      return {
        band: b,
        n: bucket.n,
        avg_confidence: Number((avg * 100).toFixed(1)),
        hit_rate: Number((hr * 100).toFixed(1)),
        gap: Number(((hr - avg) * 100).toFixed(1)),
      }
    })

  return {
    n_total: outcomes.length,
    n_measured: n,
    overall_hit_rate: Number(((hits / n) * 100).toFixed(1)),
    bins,
    brier_score: Number((brier / n).toFixed(4)),
  }
}
