import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { SyntheticNote } from '@/components/decisionos'
import CitedText from '@/components/CitedText'
import EvidenceList from '@/components/EvidenceList'
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
      // fact_snapshot is the immutable copy captured at citation time (0013). The
      // joined facts() row is null once that fact is pruned from the live table,
      // so the snapshot is what keeps old decisions auditable — always select both.
      .select('fact_id, fact_snapshot, facts(id,metric,dims,value,value_text,time_window)')
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
  const factRows = (factRes.data ?? []) as unknown as {
    fact_id: string | null
    fact_snapshot: { id?: string; metric?: string; value?: number | string | null; window?: string | null } | null
    facts: {
      id: string
      metric: string
      dims: Record<string, unknown> | null
      value: number | null
      value_text: string | null
      time_window: string | null
    } | null
  }[]

  // Collapse each citation to one display shape. The value shown is the one the decision
  // was made on — the snapshot captured at save time — not today's number. The live fact
  // is only used when no snapshot exists, and to flag drift when it has since changed.
  const citations = factRows.map((row) => {
    const snap = row.fact_snapshot
    const current = row.facts ? (row.facts.value ?? row.facts.value_text) : null
    const cited = snap && snap.value !== undefined ? snap.value : current
    return {
      fact_id: row.fact_id ?? snap?.id ?? null,
      metric: snap?.metric ?? row.facts?.metric ?? null,
      value: cited,
      window: snap?.window ?? row.facts?.time_window ?? null,
      live: !!row.facts,
      drifted_to:
        row.facts && snap && snap.value != null && current != null && String(snap.value) !== String(current)
          ? current
          : null,
    }
  })
  // decision_facts holds one row per (claim, fact) pair, so a fact backing a claim, a
  // risk and an alternative appears three times. Show each fact once, with its use count.
  const byFact = new Map<string, (typeof citations)[number] & { uses: number }>()
  citations.forEach((c, i) => {
    const key = c.fact_id ?? `cite-${i}`
    const seen = byFact.get(key)
    if (seen) seen.uses += 1
    else byFact.set(key, { ...c, uses: 1 })
  })
  const facts = [...byFact.values()]

  const ctx = extractContext(factRows)
  const audit = auditRes.data ?? []
  const outcomes = outcomeRes.data ?? []

  const order = facts.map((f) => f.fact_id).filter((x): x is string => !!x)
  const created = decision.created_at ? new Date(decision.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const sevTone: Record<string, string> = { high: 'text-act', medium: 'text-watch', low: 'text-slate-500' }

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8 py-8 lg:py-12">
      <Link href="/dashboard/inbox" className="text-sm text-slate-500 hover:text-slate-900">
        All decisions
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="rounded-full bg-white border border-line px-2.5 py-0.5 capitalize text-slate-700">{decision.status}</span>
          <span>{decision.type} decision</span>
          <span aria-hidden="true">/</span>
          <span>{decision.urgency} urgency</span>
          {created && (
            <>
              <span aria-hidden="true">/</span>
              <span>{created}</span>
            </>
          )}
        </div>
        <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">{decision.title}</h1>
        {decision.problem && <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-600">{decision.problem}</p>}
        {decision.whynow && <p className="mt-2 max-w-3xl text-sm text-slate-500">Why now: {decision.whynow}</p>}
        <SyntheticNote />
      </header>

      {e ? (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-6">
            <section className="rounded-2xl bg-ink p-7 text-slate-200 animate-rise">
              <h2 className="text-sm font-medium text-[#6fbfa4]">Recommendation</h2>
              <p className="mt-3 text-xl sm:text-2xl font-medium leading-snug text-white [&_button]:bg-white/10 [&_button]:text-white">
                <CitedText text={e.recommendation} order={order} />
              </p>
              <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/10 pt-5">
                <div>
                  <p className="num text-2xl font-semibold text-white">{e.confidence ?? '—'}<span className="text-base text-slate-400">/100</span></p>
                  <p className="text-xs text-slate-400">Confidence</p>
                </div>
                <div>
                  <p className="num text-2xl font-semibold text-white">{e.data_health ?? '—'}<span className="text-base text-slate-400">/100</span></p>
                  <p className="text-xs text-slate-400">Data quality behind it</p>
                </div>
                <div>
                  <p className="num text-2xl font-semibold text-white">{facts.length}</p>
                  <p className="text-xs text-slate-400">Pieces of evidence</p>
                </div>
              </div>
            </section>

            {e.summary && (
              <section className="rounded-2xl border border-line bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">Why</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-700">
                  <CitedText text={e.summary} order={order} />
                </p>
              </section>
            )}

            {risks.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">Risks</h2>
                <ul className="mt-3 space-y-3">
                  {risks.map((r) => (
                    <li key={r.id} className="flex gap-3">
                      <span className={`w-16 shrink-0 text-xs font-semibold capitalize pt-0.5 ${sevTone[r.severity] ?? 'text-slate-500'}`}>{r.severity}</span>
                      <p className="text-sm leading-relaxed text-slate-700">
                        <CitedText text={r.risk} order={order} />
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {alts.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">Other options considered</h2>
                <ul className="mt-3 divide-y divide-line">
                  {alts.map((a) => (
                    <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium text-slate-900">
                        <CitedText text={a.option} order={order} />
                      </p>
                      {a.tradeoff && (
                        <p className="mt-1 text-sm text-slate-500">
                          <CitedText text={a.tradeoff} order={order} />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            {facts.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900">Evidence</h2>
                <p className="mt-1 text-xs text-slate-500">Values as of when this decision was made. Click to see the source rows.</p>
                <div className="mt-2">
                  <EvidenceList items={facts} />
                </div>
              </section>
            )}
            <p className="px-1 text-xs text-slate-500">
              {e.model === 'deterministic-fallback'
                ? 'Drafted by the rule-based engine (the AI model was unavailable).'
                : e.model
                  ? `Drafted by ${e.model}, checked against the evidence before saving.`
                  : null}
            </p>
          </aside>
        </div>
      ) : (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-sm text-slate-600">
          This decision has no analysis yet.
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">Explore the numbers</h2>
        <p className="mt-1 text-sm text-slate-500">
          {ctx.sku} in {ctx.region}: what happened, why, what comes next, and what to do.
        </p>
        <div className="mt-4 rounded-2xl border border-line bg-white p-6">
          <LayerTabs sku={ctx.sku} region={ctx.region} analysis={null} />
        </div>
      </section>

      <section className="mt-10 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">What actually happened</h2>
          <p className="mt-1 text-sm text-slate-500">Record the real result so future recommendations learn from it.</p>
          {outcomes.length > 0 && (
            <ul className="mt-4 divide-y divide-line">
              {outcomes.map((o) => {
                const delta = o.predicted !== null && o.actual !== null ? (o.actual as number) - (o.predicted as number) : null
                return (
                  <li key={o.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3 text-sm">
                    <span className="flex-1 min-w-[140px] font-medium text-slate-900">{o.metric}</span>
                    <span className="num text-slate-500">expected <span className="text-slate-900">{o.predicted ?? '—'}</span></span>
                    <span className="num text-slate-500">actual <span className="text-slate-900">{o.actual ?? '—'}</span></span>
                    {delta !== null && (
                      <span className={`num text-xs font-semibold ${delta >= 0 ? 'text-shelf' : 'text-act'}`}>
                        {delta >= 0 ? '+' : ''}
                        {delta}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-5 border-t border-line pt-5">
            <OutcomeForm decisionId={id} />
          </div>
          {outcomes.length > 0 && <CloseDecisionButton decisionId={id} />}
        </div>

        {audit.length > 0 && (
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">History</h2>
            <ol className="mt-3 space-y-3 border-l border-line pl-4">
              {audit.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
                  <p className="text-slate-800">{a.detail}</p>
                  <p className="text-xs text-slate-500">
                    {a.actor}
                    {a.created_at ? `, ${new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </main>
  )
}
