// DecisionOS shared contract types. Mirror supabase/migrations/0001_init.sql.
// Any numeric claim shown to a user must carry a fact id (see GroundedClaim).

export type Severity = 'high' | 'medium' | 'low'
export type DecisionType = 'Strategic' | 'Operational' | 'Marketing'
export type DecisionStatus = 'pending' | 'review' | 'approved' | 'executing' | 'measured'

// A computed, grounded fact. The agent may only reference numbers by `id`.
export interface Fact {
  id: string
  metric: string
  dims: Record<string, string | number>
  value: number | null
  valueText: string | null
  time_window: string | null
  method: string             // 'sql:zscore' | 'ml:gbm' | 'rule' ...
  sampleN: number | null
  confidence: number | null  // 0..1, computed
  computedAt: string
  // Trust + lineage columns (migration 0007).
  data_health: number | null      // 0..1, freshness × completeness × source_conf
  formula_id: string | null       // -> src/lib/metrics/registry.ts entry
  unstable: boolean               // outlier guard flag
  source_rows: Array<{ table: string; pk: string | number }>
}

export interface Decision {
  id: string
  title: string
  type: DecisionType
  urgency: 'High' | 'Medium' | 'Low'
  proposer?: string
  role?: string
  status: DecisionStatus
  problem?: string
  whynow?: string
  alternativesText?: string
  createdAt: string
}

export interface Enrichment {
  decisionId: string
  summary: string
  recommendation: string
  confidence: number   // COMPUTED by code, never the LLM
  dataHealth: number   // COMPUTED (% non-null in used facts)
  riskLevel: Severity
  model: string
  grounded: boolean
  createdAt: string
}

export interface Risk { id?: number; decisionId: string; risk: string; severity: Severity; factId: string | null }
export interface Alternative { id?: number; decisionId: string; option: string; tradeoff?: string }
export interface Reviewer { id?: number; decisionId: string; name?: string; role?: string; status: 'pending' | 'approved' | 'flagged'; comment?: string }
export interface AuditEntry { id?: number; decisionId: string; type: string; actor: string; detail?: string; hash?: string; createdAt: string }
export interface Outcome { id?: number; decisionId: string; metric: string; predicted: number | null; actual: number | null; horizon?: string; measuredAt?: string }
export interface MemoryItem { id: string; decisionId?: string; title: string; decidedOn?: string; outcome?: 'win' | 'loss' | 'mixed'; predicted?: number; actual?: number; lesson?: string }
export interface EvalRun { id?: number; model: string; decisionId?: string; dimension: 'grounding' | 'accuracy' | 'calibration'; score: number | null; createdAt: string }

// DB-row shapes (snake_case) — these mirror the live Supabase tables exactly and
// are what server components/route handlers receive from supabase.from(...).select().
// Every numeric here is a real computed/measured row; never LLM-invented.

// `outcomes` table: id bigint (auto), decision_id text, metric text NOT NULL,
// predicted/actual numeric, horizon text, measured_at timestamptz.
export interface OutcomeRow {
  id: number
  decision_id: string
  metric: string
  predicted: number | null
  actual: number | null
  horizon: string | null
  measured_at: string | null
}

// `memory` table: id text (generated), decision_id text, title text NOT NULL,
// decided_on date, outcome text, predicted/actual numeric, lesson text.
export interface MemoryEntry {
  id: string
  decision_id: string | null
  title: string
  decided_on: string | null
  outcome: string | null
  predicted: number | null
  actual: number | null
  lesson: string | null
}

// A claim emitted by the reasoner. Every number in `text` must trace to `factIds`.
export interface GroundedClaim {
  text: string
  factIds: string[]
}
