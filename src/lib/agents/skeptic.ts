import { llm, parseJson } from './adapter'
import type { Fact } from '@/lib/types'

export interface SkepticOut {
  disagree: boolean
  refutation: string
  weakestPoint: string
}

// Adversarial cross-check: a second pass that tries to REFUTE the recommendation
// using only the same facts. Disagreement surfaces to the user (a real multi-agent
// pattern, not decoration).
export async function skeptic(recommendation: string, facts: Fact[]): Promise<SkepticOut | null> {
  const sys =
    'You are an adversarial reviewer. Try to REFUTE the recommendation using ONLY the given facts. Cite fact ids. Respond with valid JSON only.'
  const f = facts.map((x) => `[${x.id}] ${x.metric}=${x.value ?? x.valueText}`).join('; ')
  const prompt = `RECOMMENDATION: ${recommendation}\nFACTS: ${
    f || '(none)'
  }\nReturn JSON: {"disagree":true|false,"refutation":"...","weakestPoint":"..."}`
  return parseJson<SkepticOut>(
    await llm(prompt, { tier: 'fast', json: true, system: sys, maxTokens: 400 }),
  )
}
