import type { Fact } from '@/lib/types'
import type { ReasonOut, Claim, StructuredEvidence } from './reasoner'

export interface Violation {
  token: string
  reason: string
}
export interface ValidateOut {
  ok: boolean
  violations: Violation[]
}

const CITATION = /\[([a-zA-Z0-9_:-]+)\]/gi

function idsInText(text: string | undefined): string[] {
  if (!text) return []
  return Array.from(text.matchAll(CITATION)).map((match) => match[1])
}

export function collectCitedFactIds(r: ReasonOut, retrieved: Fact[]): Set<string> {
  const cited = new Set<string>()
  const addText = (text: string | undefined) => {
    for (const id of idsInText(text)) cited.add(id)
  }
  const addEvidence = (evs: StructuredEvidence[] | undefined) => {
    for (const ev of evs ?? []) cited.add(ev.fact_id)
  }

  addText(r.summary)
  addText(r.recommendation)
  for (const claim of r.claims ?? []) {
    addText(claim.text)
    addEvidence(claim.structured_evidence)
  }
  for (const risk of r.risks ?? []) {
    addText(risk.risk)
    addEvidence(risk.structured_evidence)
  }
  for (const alt of r.alternatives ?? []) {
    addText(alt.option)
    addText(alt.tradeoff)
    addEvidence(alt.structured_evidence)
  }
  return cited
}

export function validate(r: ReasonOut, retrieved: Fact[]): ValidateOut {
  const validIds = new Set(retrieved.map((f) => f.id))
  const byId = new Map(retrieved.map((f) => [f.id, f]))
  const violations: Violation[] = []

  const checkEvidence = (type: 'factual' | 'inference', evidence: StructuredEvidence[] | undefined, proseIds: string[]) => {
    const evs = evidence ?? []
    if (type === 'factual' && evs.length === 0) {
      violations.push({ token: 'evidence', reason: 'Factual claims require structured_evidence' })
    }

    const evIds = new Set(evs.map(e => e.fact_id))
    for (const pid of proseIds) {
      if (!evIds.has(pid)) {
        violations.push({ token: pid, reason: 'Prose citation missing from structured_evidence' })
      }
    }
    const proseIdSet = new Set(proseIds)
    for (const ev of evs) {
      if (!proseIdSet.has(ev.fact_id)) {
        violations.push({ token: ev.fact_id, reason: 'structured_evidence item not cited in prose text' })
      }
      if (!validIds.has(ev.fact_id)) {
        violations.push({ token: ev.fact_id, reason: 'cited fact id not in retrieved set' })
        continue
      }
      const fact = byId.get(ev.fact_id)!
      if (fact.metric !== ev.metric) {
        violations.push({ token: ev.metric, reason: 'Metric does not match cited fact' })
      }
      if (ev.value !== undefined && ev.value !== null) {
        const factVal = String(fact.value ?? fact.valueText)
        if (String(ev.value) !== factVal) {
          violations.push({ token: String(ev.value), reason: 'Value does not match cited fact' })
        }
      }
      if (ev.dims) {
        for (const [k, v] of Object.entries(ev.dims)) {
          if (String(fact.dims?.[k]) !== String(v)) {
            violations.push({ token: `${k}:${v}`, reason: 'Dimension does not match cited fact' })
          }
        }
      }
    }
  }

  // summary/recommendation carry no structured_evidence of their own — they narrate
  // claims that are individually validated below. So the bar here is membership only:
  // every bracketed id must exist in the retrieved set.
  for (const id of idsInText(r.summary)) {
    if (!validIds.has(id)) violations.push({ token: id, reason: 'cited fact id not in retrieved set' })
  }
  for (const id of idsInText(r.recommendation)) {
    if (!validIds.has(id)) violations.push({ token: id, reason: 'cited fact id not in retrieved set' })
  }

  for (const c of r.claims ?? []) {
    checkEvidence(c.type, c.structured_evidence, idsInText(c.text))
  }

  for (const risk of r.risks ?? []) {
    checkEvidence(risk.type, risk.structured_evidence, idsInText(risk.risk))
  }

  for (const alt of r.alternatives ?? []) {
    const ids = [...idsInText(alt.option), ...idsInText(alt.tradeoff)]
    checkEvidence(alt.type, alt.structured_evidence, ids)
  }

  return { ok: violations.length === 0, violations }
}

export function validateFreeText(text: string, retrieved: Fact[]): ValidateOut {
  const validIds = new Set(retrieved.map((f) => f.id))
  const violations: Violation[] = []

  for (const id of idsInText(text)) {
    if (!validIds.has(id)) {
      violations.push({ token: id, reason: 'cited fact id not in retrieved set' })
    }
  }

  return { ok: violations.length === 0, violations }
}
