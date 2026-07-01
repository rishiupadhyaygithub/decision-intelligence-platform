import type { Fact } from '@/lib/types'
import type { ReasonOut } from './reasoner'

export interface Violation {
  token: string
  reason: string
}
export interface ValidateOut {
  ok: boolean
  violations: Violation[]
}

// Deterministic grounding check. This is what makes the AI honest:
//   1) every cited fact id must be in the retrieved set
//   2) risk fact ids must be in the retrieved set
//   3) every numeric claim must match a cited fact value
const NUM = /(?<![a-z0-9_-])-?\d+(?:\.\d+)?%?(?![a-z0-9_-])/gi
const CITATION = /\[([a-z0-9_:-]+)\]/gi

function factValueStrings(facts: Fact[]): Set<string> {
  const out = new Set<string>()
  for (const f of facts) {
    if (f.value != null) {
      out.add(String(f.value))
      out.add(String(Math.round(f.value)))
      out.add(f.value.toFixed(1))
      out.add(f.value.toFixed(2))
    }
    if (f.valueText) out.add(f.valueText.replace(/[^0-9.\-]/g, ''))
  }
  return out
}

function idsInText(text: string | undefined, knownIds: Set<string>): string[] {
  if (!text) return []
  return Array.from(text.matchAll(CITATION))
    .map((match) => match[1])
    .filter((id) => knownIds.has(id))
}

function invalidIdsInText(text: string | undefined, knownIds: Set<string>): string[] {
  if (!text) return []
  return Array.from(text.matchAll(CITATION))
    .map((match) => match[1])
    .filter((id) => id.startsWith('f_') && !knownIds.has(id))
}

export function collectCitedFactIds(r: ReasonOut, retrieved: Fact[]): Set<string> {
  const knownIds = new Set(retrieved.map((f) => f.id))
  const cited = new Set<string>()
  const add = (id: string | null | undefined) => {
    if (id && knownIds.has(id)) cited.add(id)
  }
  const addText = (text: string | undefined) => {
    for (const id of idsInText(text, knownIds)) cited.add(id)
  }

  addText(r.summary)
  addText(r.recommendation)
  for (const claim of r.claims ?? []) {
    addText(claim.text)
    for (const id of claim.factIds ?? []) add(id)
  }
  for (const risk of r.risks ?? []) {
    addText(risk.risk)
    add(risk.factId)
  }
  for (const alt of r.alternatives ?? []) {
    addText(alt.option)
    addText(alt.tradeoff)
  }

  return cited
}

export function validate(r: ReasonOut, retrieved: Fact[]): ValidateOut {
  const ids = new Set(retrieved.map((f) => f.id))
  const byId = new Map(retrieved.map((f) => [f.id, f]))
  const violations: Violation[] = []

  for (const c of r.claims ?? []) {
    for (const id of c.factIds ?? []) {
      if (!ids.has(id)) violations.push({ token: id, reason: 'cited fact id not in retrieved set' })
    }
  }

  for (const risk of r.risks ?? []) {
    if (risk.factId && !ids.has(risk.factId)) {
      violations.push({ token: risk.factId, reason: 'risk fact id not in retrieved set' })
    }
  }

  const textChecks = [
    { text: r.summary, factIds: idsInText(r.summary, ids) },
    { text: r.recommendation, factIds: idsInText(r.recommendation, ids) },
    ...(r.claims ?? []).map((claim) => ({
      text: claim.text,
      factIds: [...(claim.factIds ?? []), ...idsInText(claim.text, ids)],
    })),
    ...(r.risks ?? []).map((risk) => ({
      text: risk.risk,
      factIds: [risk.factId, ...idsInText(risk.risk, ids)].filter(Boolean) as string[],
    })),
    ...(r.alternatives ?? []).flatMap((alt) => [
      { text: alt.option, factIds: idsInText(alt.option, ids) },
      { text: alt.tradeoff, factIds: idsInText(alt.tradeoff, ids) },
    ]),
  ]

  for (const text of [
    r.summary,
    r.recommendation,
    ...(r.claims ?? []).map((claim) => claim.text),
    ...(r.risks ?? []).map((risk) => risk.risk),
    ...(r.alternatives ?? []).flatMap((alt) => [alt.option, alt.tradeoff]),
  ]) {
    for (const id of invalidIdsInText(text, ids)) {
      violations.push({ token: id, reason: 'cited fact id not in retrieved set' })
    }
  }

  for (const { text, factIds } of textChecks) {
    const citedFacts = factIds.flatMap((id) => {
      const fact = byId.get(id)
      return fact ? [fact] : []
    })
    const known = factValueStrings(citedFacts)
    const nums = text?.match(NUM) ?? []
    for (const n of nums) {
      const norm = n.replace('%', '')
      const backed = known.has(norm) || known.has(norm.replace(/\.0$/, ''))
      if (!backed) violations.push({ token: n, reason: 'numeric claim not found in cited fact values' })
    }
  }

  return { ok: violations.length === 0, violations }
}


export function validateFreeText(text: string, retrieved: Fact[]): ValidateOut {
  const ids = new Set(retrieved.map((f) => f.id))
  const byId = new Map(retrieved.map((f) => [f.id, f]))
  const violations: Violation[] = []

  for (const id of invalidIdsInText(text, ids)) {
    violations.push({ token: id, reason: 'cited fact id not in retrieved set' })
  }

  const citedIds = idsInText(text, ids)
  const citedFacts = citedIds.flatMap((id) => {
    const fact = byId.get(id)
    return fact ? [fact] : []
  })
  const known = factValueStrings(citedFacts)
  const nums = text.match(NUM) ?? []
  for (const n of nums) {
    const norm = n.replace('%', '')
    const backed = known.has(norm) || known.has(norm.replace(/\.0$/, ''))
    if (!backed) {
      violations.push({ token: n, reason: 'numeric claim not found in cited fact values' })
    }
  }

  return { ok: violations.length === 0, violations }
}
