import { llm, parseJson } from './adapter'
import type { Fact, Severity } from '@/lib/types'

export interface ReasonOut {
  summary: string
  recommendation: string
  risks: { risk: string; severity: Severity; factId: string | null }[]
  alternatives: { option: string; tradeoff: string }[]
  claims: { text: string; factIds: string[] }[]
}

function factsBlock(facts: Fact[]): string {
  return facts
    .map(
      (f) =>
        `- [${f.id}] ${f.metric} ${JSON.stringify(f.dims)} = ${f.value ?? f.valueText} (${f.time_window ?? ''}, n=${f.sampleN ?? '?'}, method=${f.method})`,
    )
    .join('\n')
}

export async function reason(decisionText: string, facts: Fact[]): Promise<ReasonOut | null> {
  const sys =
    'You are a grounded business strategy analyst. You may ONLY use numbers that appear in the FACTS list, and every numeric claim MUST cite the fact id in square brackets like [fact_id]. Never invent numbers. Respond with valid JSON only.'
  const prompt = `DECISION:\n${decisionText}\n\nFACTS (cite by id; if empty, give a qualitative read with no numbers):\n${
    facts.length ? factsBlock(facts) : '(none available)'
  }\n\nReturn JSON exactly:\n{"summary":"...","recommendation":"...","risks":[{"risk":"...","severity":"high|medium|low","factId":"<id or null>"}],"alternatives":[{"option":"...","tradeoff":"..."}],"claims":[{"text":"a sentence; any number must carry a [fact_id]","factIds":["fact_id"]}]}`
  return parseJson<ReasonOut>(
    await llm(prompt, { tier: 'smart', json: true, system: sys, maxTokens: 1000 }),
  )
}

function factLabel(fact: Fact): string {
  const dims = Object.entries(fact.dims)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ')
  const value = fact.value ?? fact.valueText ?? 'available'
  const window = fact.time_window ? ` over ${fact.time_window}` : ''
  return `${fact.metric}${dims ? ` for ${dims}` : ''} is ${value}${window} [${fact.id}]`
}

function riskSeverity(fact: Fact): Severity {
  if (fact.metric.includes('anomaly') || fact.metric.includes('pressure')) return 'high'
  if (fact.metric.includes('inventory') || fact.metric.includes('velocity')) return 'medium'
  return 'low'
}

export function fallbackReason(facts: Fact[]): ReasonOut | null {
  if (!facts.length) return null
  const cited = facts.slice(0, 4)
  const primary = cited[0]

  return {
    summary: `The fact store gives a grounded read: ${factLabel(primary)}. Treat the recommendation as a constrained operating move until the cited signals improve.`,
    recommendation: `Proceed only as a measured pilot with explicit monitoring. Use ${factLabel(primary)} as the first checkpoint, and review the supporting cited facts before expanding the decision.`,
    risks: cited.slice(0, 3).map((fact) => ({
      risk: `Decision risk is tied to ${factLabel(fact)}.`,
      severity: riskSeverity(fact),
      factId: fact.id,
    })),
    alternatives: [
      {
        option: 'Run a limited pilot',
        tradeoff: `Limits downside while validating whether ${factLabel(primary)} changes after action.`,
      },
      {
        option: 'Hold and monitor',
        tradeoff: `Avoids immediate execution but may miss the window implied by ${factLabel(primary)}.`,
      },
    ],
    claims: cited.map((fact) => ({
      text: factLabel(fact),
      factIds: [fact.id],
    })),
  }
}
