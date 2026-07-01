// DecisionOS — MEMORY HARVEST (deterministic loop-closure).
//
// GROUNDING CONTRACT (non-negotiable): every numeric and the outcome label/lesson
// written here are computed IN CODE from real DB rows. Nothing is invented by an LLM.
// This module is pure + deterministic: same rows in -> same memory row out.
//
// Loop closure: a decision is only harvestable once it is 'closed' or 'executed'
// AND it has at least one measured outcome (outcomes.actual is non-null).
// We compare the decision's predicted signal (enrichment.confidence, falling back
// to enrichment.data_health) against the realized outcome (outcomes.actual) and
// emit a single memory row capturing the lesson.

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Thresholds — documented and fixed. Predicted & actual are normalized to 0..1.
//
// enrichment.confidence / data_health are stored as 0..1 OR 0..100 in the wild;
// outcomes.actual is a raw metric. To compare apples to apples we reduce both to a
// 0..1 "success ratio":
//   - predicted: normalized confidence (see normalizeUnit) — the model's stated
//     probability/expectation that the decision pays off.
//   - actual: realized success ratio = clamp(actual / predictedTarget?, ...) when a
//     numeric target exists; otherwise the mean of (actual normalized) across rows.
//
// We then take the ABSOLUTE ERROR between predicted and actual success ratios:
//   absError = |predicted - actual|
//
// Label bands (absolute error on the 0..1 scale):
//   HIT     : absError <= 0.15   (prediction landed within 15 points)
//   PARTIAL : 0.15 < absError <= 0.35   (directionally right, materially off)
//   MISS    : absError > 0.35   (prediction was wrong)
//
// Rationale: 0.15 ~ "within normal calibration noise"; 0.35 ~ the point past which
// the prediction stops being decision-useful. These are the only magic numbers and
// they live here, in code, by design.
// ---------------------------------------------------------------------------
export const HIT_MAX_ABS_ERROR = 0.15
export const PARTIAL_MAX_ABS_ERROR = 0.35

export type OutcomeLabel = 'hit' | 'miss' | 'partial'

export interface HarvestResult {
  id: string
  decision_id: string
  title: string
  decided_on: string | null
  outcome: OutcomeLabel
  predicted: number
  actual: number
  lesson: string
}

interface DecisionRow {
  id: string
  title: string | null
  status: string | null
  created_at: string | null
}

interface EnrichmentRow {
  confidence: number | null
  data_health: number | null
}

interface OutcomeRow {
  metric: string
  predicted: number | null
  actual: number | null
}

const HARVESTABLE_STATUSES = new Set(['closed', 'executed'])

/**
 * Normalize a value that may be expressed as 0..1 or 0..100 down to 0..1.
 * Deterministic: values <= 1 are treated as already-normalized fractions.
 */
function normalizeUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  const v = value <= 1 && value >= 0 ? value : value / 100
  return Math.min(1, Math.max(0, v))
}

/**
 * Reduce measured outcomes to a single realized success ratio in 0..1.
 * For each row with both predicted (target) and actual, ratio = actual/target
 * (clamped). When a row has actual but no usable target, the actual is unit-
 * normalized directly. The result is the mean across usable rows.
 * Returns null when no row carries a measured actual.
 */
function realizedSuccessRatio(rows: OutcomeRow[]): number | null {
  const ratios: number[] = []
  for (const r of rows) {
    if (r.actual == null || !Number.isFinite(r.actual)) continue
    if (r.predicted != null && Number.isFinite(r.predicted) && r.predicted !== 0) {
      ratios.push(Math.min(1, Math.max(0, r.actual / r.predicted)))
    } else {
      ratios.push(normalizeUnit(r.actual))
    }
  }
  if (ratios.length === 0) return null
  return ratios.reduce((a, b) => a + b, 0) / ratios.length
}

function labelFor(absError: number): OutcomeLabel {
  if (absError <= HIT_MAX_ABS_ERROR) return 'hit'
  if (absError <= PARTIAL_MAX_ABS_ERROR) return 'partial'
  return 'miss'
}

/** Deterministic lesson string built entirely from computed numbers. */
function lessonFor(
  label: OutcomeLabel,
  predicted: number,
  actual: number,
  absError: number,
): string {
  const p = (predicted * 100).toFixed(0)
  const a = (actual * 100).toFixed(0)
  const e = (absError * 100).toFixed(0)
  const direction = actual >= predicted ? 'outperformed' : 'underperformed'
  switch (label) {
    case 'hit':
      return `Calibrated: predicted ${p}% success, realized ${a}% (abs error ${e}pts). Keep this decision pattern as a positive signal.`
    case 'partial':
      return `Partially right: predicted ${p}%, realized ${a}% (${direction}, abs error ${e}pts). Direction held but magnitude was off — tighten estimates for this decision type.`
    case 'miss':
      return `Miss: predicted ${p}%, realized ${a}% (${direction}, abs error ${e}pts). The prediction was not decision-useful — review the facts and reasoning behind this call.`
  }
}

/**
 * Harvest a single decision into the memory table.
 * Deterministic and side-effect-only-at-the-end (one upsert). Throws on
 * non-harvestable input so callers can surface a precise reason.
 *
 * @returns the memory row that was upserted.
 */
export async function harvestDecisionMemory(
  supabase: SupabaseClient,
  decisionId: string,
): Promise<HarvestResult> {
  // 1a. Read the decision. Must exist and be closed/executed.
  const { data: decision, error: dErr } = await supabase
    .from('decisions')
    .select('id, title, status, created_at')
    .eq('id', decisionId)
    .maybeSingle<DecisionRow>()

  if (dErr) throw new Error(`harvest: failed to read decision ${decisionId}: ${dErr.message}`)
  if (!decision) throw new Error(`harvest: decision ${decisionId} not found`)
  if (!decision.status || !HARVESTABLE_STATUSES.has(decision.status)) {
    throw new Error(
      `harvest: decision ${decisionId} has status '${decision.status}', expected 'closed' or 'executed'`,
    )
  }

  // 1b. Read enrichment — predicted signal = confidence, fallback data_health.
  const { data: enrichment, error: eErr } = await supabase
    .from('decision_enrichment')
    .select('confidence, data_health')
    .eq('decision_id', decisionId)
    .maybeSingle<EnrichmentRow>()

  if (eErr) throw new Error(`harvest: failed to read enrichment for ${decisionId}: ${eErr.message}`)

  const predictedRaw =
    enrichment?.confidence ?? enrichment?.data_health ?? null
  if (predictedRaw == null || !Number.isFinite(predictedRaw)) {
    throw new Error(
      `harvest: decision ${decisionId} has no computed predicted signal (confidence/data_health)`,
    )
  }
  const predicted = normalizeUnit(predictedRaw)

  // 1c. Read measured outcomes — actual.
  const { data: outcomes, error: oErr } = await supabase
    .from('outcomes')
    .select('metric, predicted, actual')
    .eq('decision_id', decisionId)
    .returns<OutcomeRow[]>()

  if (oErr) throw new Error(`harvest: failed to read outcomes for ${decisionId}: ${oErr.message}`)

  const actual = realizedSuccessRatio(outcomes ?? [])
  if (actual == null) {
    throw new Error(`harvest: decision ${decisionId} has no measured outcome (outcomes.actual is null)`)
  }

  // 2. Compute label + lesson IN CODE — never invented.
  const absError = Math.abs(predicted - actual)
  const outcome = labelFor(absError)
  const lesson = lessonFor(outcome, predicted, actual, absError)

  // 3. Upsert one memory row. id is deterministic per decision so re-harvest
  //    updates in place rather than duplicating.
  const decidedOn = decision.created_at ? decision.created_at.slice(0, 10) : null
  const row: HarvestResult = {
    id: `mem_${decisionId}`,
    decision_id: decisionId,
    title: decision.title ?? `Decision ${decisionId}`,
    decided_on: decidedOn,
    outcome,
    predicted: Number(predicted.toFixed(4)),
    actual: Number(actual.toFixed(4)),
    lesson,
  }

  const { error: upErr } = await supabase
    .from('memory')
    .upsert(row, { onConflict: 'id' })

  if (upErr) throw new Error(`harvest: failed to upsert memory for ${decisionId}: ${upErr.message}`)

  return row
}
