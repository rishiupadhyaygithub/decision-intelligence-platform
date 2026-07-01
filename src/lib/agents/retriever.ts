import { createAdminClient } from '@/lib/supabase-admin'
import type { Fact } from '@/lib/types'

interface FactRow {
  id: string
  metric: string
  dims: Record<string, unknown>
  value: number | null
  value_text: string | null
  time_window: string | null
  method: string
  sample_n: number | null
  confidence: number | null
  computed_at: string
  data_health: number | null
  formula_id: string | null
  unstable: boolean | null
  source_rows: unknown
}

function toFact(r: FactRow): Fact {
  return {
    id: r.id,
    metric: r.metric,
    dims: (r.dims as Record<string, string | number>) ?? {},
    value: r.value,
    valueText: r.value_text,
    time_window: r.time_window,
    method: r.method,
    sampleN: r.sample_n,
    confidence: r.confidence,
    computedAt: r.computed_at,
    data_health: r.data_health,
    formula_id: r.formula_id,
    unstable: !!r.unstable,
    source_rows: Array.isArray(r.source_rows)
      ? (r.source_rows as Array<{ table: string; pk: string | number }>)
      : [],
  }
}

// Keyword retrieval over the fact store. Embeddings/pgvector arrive in migration 0004;
// until then we rank facts by term overlap between the decision text and metric+dims.
export async function retrieveFacts(decisionText: string, limit = 12): Promise<Fact[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('facts')
    .select('*')
    .order('computed_at', { ascending: false })
    .limit(200)
  if (error || !data) return []

  const terms = Array.from(new Set((decisionText.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? [])))
  const scored = (data as FactRow[])
    .map((r) => {
      const hay = (r.metric + ' ' + JSON.stringify(r.dims)).toLowerCase()
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0)
      return { r, score }
    })
    .sort((a, b) => b.score - a.score)

  const matched = scored.filter((s) => s.score > 0).slice(0, limit)
  if (!matched.length) return []
  return matched.map((s) => toFact(s.r))
}
