// W4.2 — SKU churn risk (rule-based logistic).
// Inputs: recent velocity delta %, stockout risk ratio, competitor pressure %.
// Output: probability the SKU loses > 20% next quarter.
//
// Coefficients handpicked from directional signal — Python trainer
// (ml/churn.py) fits a proper GBM offline; this is the fast in-process fallback
// so the UI works without invoking Python.

export interface ChurnFeatures {
  velocity_delta_pct: number | null
  cover_ratio: number | null
  competitor_pressure_pct: number | null
}

export interface ChurnOutput {
  risk_score: number
  band: 'low' | 'medium' | 'high'
  reasons: string[]
  features_used: ChurnFeatures
  method: 'logistic_rule'
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

// z = b0 + b1*(-velocity_delta) + b2*(1/cover) + b3*competitor
const B0 = -1.2
const B1 = 0.04    // velocity drop of 25% adds ~1 unit z
const B2 = 0.9     // cover < 1 pushes strongly
const B3 = 0.015   // competitor pressure 60% adds ~0.9

export function churn(features: ChurnFeatures): ChurnOutput {
  const v = features.velocity_delta_pct ?? 0
  const c = features.cover_ratio ?? 2
  const p = features.competitor_pressure_pct ?? 0

  const coverPenalty = c > 0 ? Math.max(0, 1 / Math.max(c, 0.2) - 0.5) : 1
  const z = B0 + B1 * -v + B2 * coverPenalty + B3 * p
  const risk = sigmoid(z)

  const reasons: string[] = []
  if (v < -10) reasons.push(`velocity down ${v.toFixed(1)}%`)
  if (c < 1) reasons.push(`cover ratio ${c.toFixed(2)} < 1 (short)`)
  if (p > 50) reasons.push(`competitor pressure ${p.toFixed(0)}%`)
  if (reasons.length === 0) reasons.push('no dominant signal')

  const band: ChurnOutput['band'] = risk >= 0.66 ? 'high' : risk >= 0.33 ? 'medium' : 'low'

  return {
    risk_score: Number(risk.toFixed(3)),
    band,
    reasons,
    features_used: features,
    method: 'logistic_rule',
  }
}
