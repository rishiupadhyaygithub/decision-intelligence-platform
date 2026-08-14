import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Fact } from '@/lib/types'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { retrieveFacts } from '@/lib/agents/retriever'
import { fallbackReason, reason } from '@/lib/agents/reasoner'
import { skeptic } from '@/lib/agents/skeptic'
import { collectCitedFactIds, validate, validateFreeText } from '@/lib/agents/validator'
import { score } from '@/lib/agents/scorer'
import { checkStrict, DEFAULT_STRICT } from '@/lib/grounding/validate'
import { shapeTradeoffs } from '@/lib/prescribe/tradeoffs'
import { computeConfidence } from '@/lib/prescribe/confidence'

const Body = z.object({
  title: z.string().min(1).max(500),
  proposal: z.string().min(1).max(5000),
  context: z.string().optional(),
})

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await request.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'title and proposal are required' }, { status: 400 })
  }
  const { title, proposal, context } = parsed.data
  const decisionText = `${title}\n${proposal}\n${context ?? ''}`.trim()

  let facts: Fact[]
  try {
    facts = await retrieveFacts(decisionText)
  } catch (e) {
    console.error('retrieveFacts failed', e)
    return NextResponse.json({ error: 'Fact store unavailable' }, { status: 503 })
  }

  if (!facts.length) {
    return NextResponse.json(
      { error: 'No relevant facts found for this decision. Try more specific terms (SKU, region).' },
      { status: 422 },
    )
  }

  let model = 'gemini-3.5-flash'
  let r = await reason(decisionText, facts)
  if (!r) {
    r = fallbackReason(facts)
    model = 'deterministic-fallback'
  }
  if (!r) {
    return NextResponse.json({ error: 'Analysis unavailable' }, { status: 502 })
  }

  let check = validate(r, facts)
  if (!check.ok) {
    const retry = await reason(
      `${decisionText}\n\nFix: cite only fact ids from the list and remove unbacked numbers. Violations: ${JSON.stringify(check.violations)}`,
      facts,
    )
    if (retry) {
      r = retry
      check = validate(r, facts)
    }
  }
  if (!check.ok) {
    const fb = fallbackReason(facts)
    if (fb) {
      r = fb
      model = 'deterministic-fallback'
      check = validate(r, facts)
    }
  }
  if (!check.ok || !r) {
    return NextResponse.json(
      { error: 'Could not produce grounded analysis', validation: check },
      { status: 422 },
    )
  }

  const citedFactIds = collectCitedFactIds(r, facts)
  const usedFacts = facts.filter((fact) => citedFactIds.has(fact.id))
  const grounded = usedFacts.length > 0 && check.ok
  const { confidence: confAvg, dataHealth } = score(usedFacts)

  // W5.2 — strict grounding gate on cited facts (data_health floor, freshness,
  // unstable-flag reject). Failure surfaces as a soft error field; the caller
  // sees the reasons and can still show the raw analysis if they choose.
  const strict = checkStrict(usedFacts as unknown as Parameters<typeof checkStrict>[0], DEFAULT_STRICT)

  // W5.4 — composite confidence: data_health × forecast_certainty × driver_clarity.
  // We don't have forecast/driver context in this endpoint call, so plug defaults
  // and let the L4 UI enrich if it wants a per-context score. cited_health from
  // strict output is authoritative.
  const composite = computeConfidence({
    cited_health: strict.cited_health || dataHealth / 100,
    forecast_cv: null,
    top_driver_share_pct: null,
    n_cited_facts: usedFacts.length,
  })

  // W5.3 — tradeoff options guaranteed >= 2.
  const options = shapeTradeoffs(
    { recommendation: r.recommendation, alternatives: r.alternatives, summary: r.summary },
    usedFacts,
    null,
  )

  let skepticOut: { disagrees: boolean; refutation: string } | null = null
  const sk = await skeptic(r.recommendation, usedFacts)
  if (sk?.refutation) {
    const skCheck = validateFreeText(sk.refutation, usedFacts)
    if (skCheck.ok) {
      skepticOut = { disagrees: sk.disagree, refutation: sk.refutation }
    }
  }

  const decisionId = crypto.randomUUID()
  const snapshots: any[] = []
  
  let claimIndex = 0
  for (const c of r.claims ?? []) {
    for (const ev of c.structured_evidence ?? []) {
      const fact = usedFacts.find(f => f.id === ev.fact_id)
      if (fact) snapshots.push({ claim_index: claimIndex, claim_type: 'claim', fact_id: fact.id, fact_snapshot: fact })
    }
    claimIndex++
  }

  let riskIndex = 0
  for (const c of r.risks ?? []) {
    for (const ev of c.structured_evidence ?? []) {
      const fact = usedFacts.find(f => f.id === ev.fact_id)
      if (fact) snapshots.push({ claim_index: riskIndex, claim_type: 'risk', fact_id: fact.id, fact_snapshot: fact })
    }
    riskIndex++
  }

  let altIndex = 0
  for (const c of r.alternatives ?? []) {
    for (const ev of c.structured_evidence ?? []) {
      const fact = usedFacts.find(f => f.id === ev.fact_id)
      if (fact) snapshots.push({ claim_index: altIndex, claim_type: 'alternative', fact_id: fact.id, fact_snapshot: fact })
    }
    altIndex++
  }

  const decisionObj = {
    id: decisionId,
    title,
    problem: proposal,
    enrichment: {
      summary: r.summary,
      recommendation: r.recommendation,
      confidence: confAvg,
      dataHealth: dataHealth,
      riskLevel: r.risks?.[0]?.severity ?? 'low',
      model,
      grounded: grounded && strict.passed
    }
  }

  const { data: saveResult, error: saveError } = await supabase.rpc('save_decision_lineage', {
    p_decision: decisionObj,
    p_snapshots: snapshots
  })

  if (saveError) {
    console.error('Failed to save decision lineage:', saveError)
  }

  return NextResponse.json({
    id: decisionId,
    saved: !!saveResult,
    saved_snapshots: saveResult?.snapshots ?? 0,
    analysis: {
      summary: r.summary,
      top_risks: (r.risks ?? []).map((x) => ({
        risk: x.risk,
        severity: x.severity,
        fact_id: x.structured_evidence?.[0]?.fact_id ?? null,
      })),
      alternatives: r.alternatives ?? [],
      recommendation: r.recommendation,
      options,                                    // W5.3
      data_health_score: dataHealth,
      confidence: confAvg,                        // legacy field
      confidence_composite: composite,            // W5.4
      strict_grounding: strict,                   // W5.2
      model,
      grounded: grounded && strict.passed,        // now honors strict gate
      facts_used: usedFacts.map((f) => ({
        id: f.id,
        metric: f.metric,
        value: f.value ?? f.valueText,
        window: f.time_window,
      })),
      skeptic: skepticOut,
      validation: { ok: check.ok, violations: check.violations },
    },
  })
}
