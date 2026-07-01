// W3.2 — Anomaly detector.
// Two strategies, run together:
//   (a) STL-lite: subtract rolling median (window 4), flag residual > k * MAD.
//   (b) Level-shift: last-4-weeks mean vs prior-N-weeks mean, flag if |z| > 2.
// MAD is robust to outliers, unlike stdev — matters for spikey FMCG demand.

export type Series = { week: string; value: number }

export interface Anomaly {
  week: string
  value: number
  expected: number
  residual: number
  z: number
  kind: 'point' | 'level_shift'
}

const median = (a: number[]) => {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const mad = (a: number[]) => {
  if (a.length === 0) return 0
  const m = median(a)
  return median(a.map((v) => Math.abs(v - m))) || 1e-9
}

function rollingMedian(values: number[], win: number): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - win + 1)
    out.push(median(values.slice(start, i + 1)))
  }
  return out
}

export function detect(series: Series[], opts: { madK?: number; levelZ?: number } = {}): Anomaly[] {
  const madK = opts.madK ?? 3.5
  const levelZ = opts.levelZ ?? 2
  const sorted = [...series].sort((a, b) => a.week.localeCompare(b.week))
  if (sorted.length < 6) return []

  const vals = sorted.map((s) => s.value)
  const trend = rollingMedian(vals, 4)
  const resid = vals.map((v, i) => v - trend[i])
  const scale = mad(resid) * 1.4826

  const anomalies: Anomaly[] = []
  for (let i = 0; i < sorted.length; i++) {
    const z = scale > 0 ? resid[i] / scale : 0
    if (Math.abs(z) >= madK) {
      anomalies.push({
        week: sorted[i].week,
        value: sorted[i].value,
        expected: Number(trend[i].toFixed(2)),
        residual: Number(resid[i].toFixed(2)),
        z: Number(z.toFixed(2)),
        kind: 'point',
      })
    }
  }

  if (sorted.length >= 8) {
    const recent = vals.slice(-4)
    const prior = vals.slice(0, -4)
    const mR = recent.reduce((a, b) => a + b, 0) / recent.length
    const mP = prior.reduce((a, b) => a + b, 0) / prior.length
    const sP = Math.sqrt(prior.reduce((a, v) => a + (v - mP) ** 2, 0) / (prior.length || 1)) || 1e-9
    const z = (mR - mP) / sP
    if (Math.abs(z) >= levelZ) {
      anomalies.push({
        week: sorted[sorted.length - 1].week,
        value: Number(mR.toFixed(2)),
        expected: Number(mP.toFixed(2)),
        residual: Number((mR - mP).toFixed(2)),
        z: Number(z.toFixed(2)),
        kind: 'level_shift',
      })
    }
  }

  return anomalies
}
