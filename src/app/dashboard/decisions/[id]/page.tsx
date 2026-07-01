import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/TopNav'
import { SyntheticNote, SeverityPill, GroundedBadge, FactChip, Gauge } from '@/components/decisionos'
import OutcomeForm from '@/components/OutcomeForm'
import CloseDecisionButton from '@/components/CloseDecisionButton'
import { LayerTabs } from '@/components/LayerTabs'
import type { OutcomeRow } from '@/lib/types'

// Pull sku + region from the first cited fact that carries both dims.
// Falls back to a demo default so L2/L3 panels still render on cold decisions.
function extractContext(
  factRows: { facts: { dims?: Record<string, unknown> | null } | null }[],
): { sku: string; region: string } {
  for (const r of factRows) {
    const dims = (r.facts?.dims ?? {}) as Record<string, unknown>
    const sku = typeof dims.sku === 'string' ? dims.sku : null
    const region = typeof dims.region === 'string' ? dims.region : null
    if (sku && region) return { sku, region }
  }
  return { sku: 'SC-001', region: 'West' }
}

export default async function DecisionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: decision } = await supabase.from('decisions').select('*').eq('id', id).single()
  if (!decision) notFound()

  const [enrRes, riskRes, altRes, factRes, auditRes, outcomeRes] = await Promise.all([
    supabase.from('decision_enrichment').select('*').eq('decision_id', id).maybeSingle(),
    supabase.from('risks').select('*').eq('decision_id', id),
    supabase.from('alternatives').select('*').eq('decision_id', id),
    supabase
      .from('decision_facts')
      .select('fact_id, facts(id,metric,dims,value,value_text,time_window)')
      .eq('decision_id', id),
    supabase.from('audit_log').select('*').eq('decision_id', id).order('created_at', { ascending: true }),
    supabase
      .from('outcomes')
      .select('*')
      .eq('decision_id', id)
      .order('measured_at', { ascending: false })
      .returns<OutcomeRow[]>(),
  ])
  const e = enrRes.data
  const risks = riskRes.data ?? []
  const alts = altRes.data ?? []
  const facts = (factRes.data ?? []) as unknown as {
    fact_id: string
    facts: {
      id: string
      metric: string
      dims: Record<string, unknown> | null
      value: number | null
      value_text: string | null
      time_window: string | null
    } | null
  }[]
  const ctx = extractContext(facts)
  const audit = auditRes.data ?? []
  const outcomes = outcomeRes.data ?? []

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav email={user.email} />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">
          ← Dashboard
        </Link>

        <SyntheticNote />
        <div className="bg-white rounded-xl border border-slate-200 p-6 mt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{decision.title}</h1>
              <p className="text-xs text-slate-400 mt-1">
                {decision.type} · {decision.urgency} · <span className="capitalize">{decision.status}</span>
                {decision.proposer ? ` · ${decision.proposer}` : ''}
              </p>
            </div>
            {e && <GroundedBadge grounded={!!e.grounded} count={facts.length} />}
          </div>
          {decision.problem && <p className="mt-4 text-sm text-slate-600 leading-relaxed">{decision.problem}</p>}
          {decision.whynow && (
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              <span className="font-medium text-slate-600">Why now: </span>
              {decision.whynow}
            </p>
          )}
        </div>

        {/* W6 — 4-layer decision view: What / Why / Will / Should */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-medium text-slate-900">Decision layers</h3>
            <span className="text-xs text-slate-500">
              context: <span className="font-mono">{ctx.sku}</span> · <span className="font-mono">{ctx.region}</span>
            </span>
          </div>
          <LayerTabs sku={ctx.sku} region={ctx.region} analysis={null} />
        </div>

        {e && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-medium text-slate-900 mb-2">Enrichment</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{e.summary}</p>
            <p className="mt-3 text-sm text-slate-700 leading-relaxed">
              <span className="font-medium">Recommendation: </span>
              {e.recommendation}
            </p>
            <div className="mt-4 flex gap-3">
              <Gauge value={e.data_health ?? null} label="Data health" />
              <Gauge value={e.confidence ?? null} label="Confidence" />
            </div>
            {e.model && <p className="mt-2 text-xs text-slate-400">Model: {e.model}</p>}
          </div>
        )}

        {risks.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-medium text-slate-900 mb-3">Risks</h3>
            <div className="space-y-2">
              {risks.map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  <SeverityPill severity={r.severity} />
                  <span className="text-slate-700 flex-1">{r.risk}</span>
                  {r.fact_id && <FactChip id={r.fact_id} />}
                </div>
              ))}
            </div>
          </div>
        )}

        {alts.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-medium text-slate-900 mb-3">Alternatives</h3>
            <div className="space-y-3">
              {alts.map((a) => (
                <div key={a.id} className="border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-slate-900">{a.option}</p>
                  {a.tradeoff && <p className="text-xs text-slate-500 mt-1">{a.tradeoff}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {facts.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-medium text-slate-900 mb-3">Facts cited</h3>
            <ul className="space-y-1.5">
              {facts.map((row) => (
                <li key={row.fact_id} className="flex items-center gap-2 text-xs text-slate-600">
                  <FactChip id={row.fact_id} />
                  {row.facts && (
                    <>
                      <span className="font-medium">{row.facts.metric}</span>
                      <span className="text-slate-400">= {String(row.facts.value ?? row.facts.value_text)}</span>
                      {row.facts.time_window && <span className="text-slate-400">· {row.facts.time_window}</span>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-medium text-slate-900 mb-1">Outcomes · loop closure</h3>
          <p className="text-xs text-slate-400 mb-4">
            Predicted vs actual is shown only from recorded measurements. Deltas are computed from real rows.
          </p>

          {outcomes.length > 0 ? (
            <div className="space-y-2 mb-6">
              {outcomes.map((o) => {
                const hasBoth = o.predicted !== null && o.actual !== null
                const delta = hasBoth ? (o.actual as number) - (o.predicted as number) : null
                return (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  >
                    <span className="font-medium text-slate-900 flex-1 min-w-[120px]">{o.metric}</span>
                    <span className="text-slate-500">
                      pred <span className="text-slate-900">{o.predicted ?? '—'}</span>
                    </span>
                    <span className="text-slate-500">
                      actual <span className="text-slate-900">{o.actual ?? '—'}</span>
                    </span>
                    {delta !== null && (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          delta >= 0
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                      >
                        Δ {delta >= 0 ? '+' : ''}
                        {delta}
                      </span>
                    )}
                    {o.horizon && <span className="text-xs text-slate-400">· {o.horizon}</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400 mb-6">No outcomes recorded yet.</p>
          )}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-3">Record a measured outcome</p>
            <OutcomeForm decisionId={id} />
          </div>

          {outcomes.length > 0 && <CloseDecisionButton decisionId={id} />}
        </div>

        {audit.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-medium text-slate-900 mb-3">Audit trail</h3>
            <ul className="space-y-2">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400 uppercase tracking-wide w-16 shrink-0">{a.type}</span>
                  <span className="text-slate-700">{a.detail}</span>
                  <span className="text-slate-400 ml-auto shrink-0">{a.actor}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
