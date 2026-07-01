import type { Fact } from '@/lib/types'

export interface ScoreOut {
  confidence: number // 0..100
  dataHealth: number // 0..100
}

// COMPUTED by code, never the LLM. This replaces the old hardcoded
// data_health_score:75 / confidence:70 that the model used to invent.
//   dataHealth = % of used facts that carry a real value
//   confidence = mean of per-fact confidence (or sample-size proxy)
export function score(used: Fact[]): ScoreOut {
  if (!used.length) return { confidence: 0, dataHealth: 0 }

  const nonNull = used.filter((f) => f.value != null || f.valueText).length
  const dataHealth = Math.round((nonNull / used.length) * 100)

  const confs = used.map((f) => f.confidence ?? Math.min(1, (f.sampleN ?? 0) / 100))
  const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length
  const confidence = Math.round(avgConf * 100)

  return { confidence, dataHealth }
}
