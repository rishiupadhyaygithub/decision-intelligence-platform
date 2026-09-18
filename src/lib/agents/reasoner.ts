import { llm, parseJson } from './adapter'
import type { Fact, Severity } from '@/lib/types'

export interface StructuredEvidence {
  fact_id: string
  metric: string
  value?: number | string | null
  // Dimension slice the claim is about (e.g. { sku: 'SC-001', region: 'West' }).
  // validator.ts checks these against the cited fact's dims — a claim that cites a
  // real fact but the wrong slice is still a grounding violation.
  dims?: Record<string, string | number | boolean>
}

export interface Claim {
  text: string
  type: 'factual' | 'inference'
  structured_evidence: StructuredEvidence[]
}

export interface ReasonOut {
  summary: string
  recommendation: string
  risks: { risk: string; severity: Severity; type: 'factual' | 'inference'; structured_evidence: StructuredEvidence[] }[]
  alternatives: { option: string; tradeoff: string; type: 'factual' | 'inference'; structured_evidence: StructuredEvidence[] }[]
  claims: Claim[]
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
  const sys = `You are a grounded business strategy analyst.
Every claim, risk, and alternative must be explicitly classified as "factual" or "inference".
"factual" items MUST contain \`structured_evidence\` citing the exact fact_id, metric, value, and dims from the provided FACTS.
Copy \`dims\` verbatim from the cited fact — do not reword, merge, or invent dimension keys or values.
"inference" items are assumptions/projections and MUST still list the \`structured_evidence\` they are based on.
Bracket citations like [fact_id] in the prose are for presentation only; the structured_evidence array is the authoritative source.
Never invent fact IDs.
Respond with valid JSON matching the requested schema exactly.`

  const prompt = `=== SYSTEM INSTRUCTIONS ===
Use these facts for your analysis. Cite by id.
FACTS:
${facts.length ? factsBlock(facts) : '(none available)'}

OUTPUT SCHEMA:
{
  "summary": "...",
  "recommendation": "...",
  "risks": [{"risk": "...", "severity": "high|medium|low", "type": "factual|inference", "structured_evidence": [{"fact_id": "...", "metric": "...", "value": 123, "dims": {"sku": "SC-001", "region": "West"}}]}],
  "alternatives": [{"option": "...", "tradeoff": "...", "type": "factual|inference", "structured_evidence": []}],
  "claims": [{"text": "...", "type": "factual|inference", "structured_evidence": []}]
}
=== END SYSTEM INSTRUCTIONS ===

=== UNTRUSTED USER PROPOSAL ===
${decisionText}
=== END UNTRUSTED USER PROPOSAL ===`

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

  const toEv = (f: Fact): StructuredEvidence => ({
    fact_id: f.id,
    metric: f.metric,
    value: f.value ?? f.valueText,
    dims: f.dims,
  })

  return {
    summary: `The fact store gives a grounded read: ${factLabel(primary)}. Treat the recommendation as a constrained operating move until the cited signals improve.`,
    recommendation: `Proceed only as a measured pilot with explicit monitoring. Use ${factLabel(primary)} as the first checkpoint, and review the supporting cited facts before expanding the decision.`,
    risks: cited.slice(0, 3).map((fact) => ({
      risk: `Decision risk is tied to ${factLabel(fact)}.`,
      severity: riskSeverity(fact),
      type: 'factual',
      structured_evidence: [toEv(fact)],
    })),
    alternatives: [
      {
        option: 'Run a limited pilot',
        tradeoff: `Limits downside while validating whether ${factLabel(primary)} changes after action.`,
        type: 'inference',
        structured_evidence: [toEv(primary)]
      },
      {
        option: 'Hold and monitor',
        tradeoff: `Avoids immediate execution but may miss the window implied by ${factLabel(primary)}.`,
        type: 'inference',
        structured_evidence: [toEv(primary)]
      },
    ],
    claims: cited.map((fact) => ({
      text: factLabel(fact),
      type: 'factual',
      structured_evidence: [toEv(fact)],
    })),
  }
}
