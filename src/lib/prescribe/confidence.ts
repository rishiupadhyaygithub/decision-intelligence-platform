// W5.4 — Prescriptive confidence.
// confidence = data_health × forecast_certainty × driver_clarity
//   data_health      : mean data_health of cited facts (0..1)
//   forecast_certainty: 1 - clamp(cv, 0, 1) where cv = residual σ / |mean|
//   driver_clarity   : top-1 driver contribution % / 100 (falls back to 0.5)
// Result rendered 0..100.

export interface ConfidenceInputs {
  cited_health: number            // 0..1
  forecast_cv: number | null      // null when no forecast run
  top_driver_share_pct: number | null
  n_cited_facts: number
}

export interface ConfidenceOutput {
  score: number                   // 0..100
  band: 'low' | 'medium' | 'high'
  components: {
    data_health: number
    forecast_certainty: number
    driver_clarity: number
    coverage_penalty: number
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function computeConfidence(inp: ConfidenceInputs): ConfidenceOutput {
  const dataHealth = clamp01(inp.cited_health)

  const forecastCertainty =
    inp.forecast_cv == null ? 0.5 : clamp01(1 - clamp01(inp.forecast_cv))

  const driverClarity =
    inp.top_driver_share_pct == null ? 0.5 : clamp01(inp.top_driver_share_pct / 100)

  // Undercite penalty — 2 facts = full, 1 = half, 0 = kill.
  const coverage = inp.n_cited_facts >= 2 ? 1 : inp.n_cited_facts === 1 ? 0.5 : 0

  const raw = dataHealth * forecastCertainty * driverClarity * coverage
  const score = Math.round(raw * 100)
  const band: ConfidenceOutput['band'] = score >= 66 ? 'high' : score >= 33 ? 'medium' : 'low'

  return {
    score,
    band,
    components: {
      data_health: Number(dataHealth.toFixed(3)),
      forecast_certainty: Number(forecastCertainty.toFixed(3)),
      driver_clarity: Number(driverClarity.toFixed(3)),
      coverage_penalty: coverage,
    },
  }
}
