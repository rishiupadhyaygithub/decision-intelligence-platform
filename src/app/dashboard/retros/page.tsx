// W7.1 + 7.2 + 7.3 — Retros / calibration / pipeline observability in one page.
// Server-rendered — no client hydration cost.

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/TopNav'
import { computeCalibration, type Outcome as CalOutcome } from '@/lib/audit/calibration'

type OutcomeRow = {
  decision_id: string
  metric: string
  predicted: number | null
  actual: number | null
  measured_at: string | null
  decisions: { id: string; title: string; urgency: string; status: string } | null
}

type EnrichmentRow = { decision_id: string; confidence: number | null }
type FactHealthRow = { data_health: number | null; unstable: boolean | null }
type JobRunRow = {
  id: number
  job: string
  status: string
  started_at: string
  finished_at: string | null
  rows_upserted: number | null
  error: string | null
}

function bucket(v: number | null): string {
  if (v == null) return 'unknown'
  if (v >= 0.75) return 'high'
  if (v >= 0.5) return 'medium'
  return 'low'
}

export default async function RetrosPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [outRes, enrRes, factHealthRes, jobRes] = await Promise.all([
    supabase
      .from('outcomes')
      .select('decision_id, metric, predicted, actual, measured_at, decisions(id, title, urgency, status)')
      .order('measured_at', { ascending: false })
      .limit(50),
    supabase.from('decision_enrichment').select('decision_id, confidence'),
    supabase.from('facts').select('data_health, unstable'),
    supabase.from('job_runs').select('*').order('started_at', { ascending: false }).limit(20),
  ])

  const outcomes = (outRes.data ?? []) as unknown as OutcomeRow[]
  const enrichments = (enrRes.data ?? []) as EnrichmentRow[]
  const factHealth = (factHealthRes.data ?? []) as FactHealthRow[]
  const jobs = (jobRes.data ?? []) as JobRunRow[]

  const confBy: Record<string, number> = {}
  for (const e of enrichments) if (e.confidence != null) confBy[e.decision_id] = e.confidence

  const calInput: CalOutcome[] = outcomes.map((o) => ({
    decision_id: o.decision_id,
    metric: o.metric,
    predicted: o.predicted,
    actual: o.actual,
    confidence: confBy[o.decision_id] ?? null,
  }))
  const cal = computeCalibration(calInput)

  const healthBuckets = { high: 0, medium: 0, low: 0, unknown: 0 }
  let unstable = 0
  for (const f of factHealth) {
    healthBuckets[bucket(f.data_health) as keyof typeof healthBuckets] += 1
    if (f.unstable) unstable += 1
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Retros & Calibration</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Measures whether the platform&apos;s confidence tracks reality. Overall hit-rate ≈ overall confidence = well-calibrated.
          </p>
        </div>

        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-neutral-800">Calibration</h2>
            <span className="text-xs text-neutral-500">
              n = {cal.n_measured} measured of {cal.n_total} · Brier = {cal.brier_score}
            </span>
          </div>

          {cal.n_measured === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">
              No measured outcomes yet. Close a decision + log its outcome to seed this view.
            </p>
          ) : (
            <div className="mt-4">
              <div className="mb-3 text-sm text-neutral-700">
                Overall hit-rate: <span className="tabular-nums font-semibold">{cal.overall_hit_rate}%</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-1">Band</th>
                    <th className="py-1 text-right">N</th>
                    <th className="py-1 text-right">Avg conf</th>
                    <th className="py-1 text-right">Hit rate</th>
                    <th className="py-1 text-right">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {cal.bins.map((b) => (
                    <tr key={b.band} className="border-t border-neutral-100">
                      <td className="py-1 capitalize">{b.band}</td>
                      <td className="py-1 text-right tabular-nums">{b.n}</td>
                      <td className="py-1 text-right tabular-nums">{b.avg_confidence}%</td>
                      <td className="py-1 text-right tabular-nums">{b.hit_rate}%</td>
                      <td
                        className={`py-1 text-right tabular-nums ${
                          b.gap < -10 ? 'text-rose-700' : b.gap > 10 ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {b.gap > 0 ? '+' : ''}
                        {b.gap}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] italic text-neutral-500">
                Gap = hit_rate − avg_confidence. Negative gap = overconfident. |gap| ≤ 10% is healthy.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800">Closed decisions</h2>
          {outcomes.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No outcomes logged.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-1">Decision</th>
                  <th className="py-1">Metric</th>
                  <th className="py-1 text-right">Predicted</th>
                  <th className="py-1 text-right">Actual</th>
                  <th className="py-1 text-right">Confidence</th>
                  <th className="py-1">Measured</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o, i) => {
                  const c = confBy[o.decision_id] ?? null
                  return (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="py-1">
                        <Link
                          href={`/dashboard/decisions/${o.decision_id}`}
                          className="text-neutral-900 hover:underline"
                        >
                          {o.decisions?.title ?? o.decision_id}
                        </Link>
                      </td>
                      <td className="py-1 text-neutral-700">{o.metric}</td>
                      <td className="py-1 text-right tabular-nums">{o.predicted ?? '—'}</td>
                      <td className="py-1 text-right tabular-nums">{o.actual ?? '—'}</td>
                      <td className="py-1 text-right tabular-nums text-neutral-700">
                        {c != null ? `${c}%` : '—'}
                      </td>
                      <td className="py-1 tabular-nums text-neutral-500">
                        {o.measured_at ? new Date(o.measured_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-neutral-800">Pipeline health</h2>
            <span className="text-xs text-neutral-500">
              {factHealth.length} facts · {unstable} flagged unstable
            </span>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
            <Stat label="High health" value={healthBuckets.high} tone="emerald" />
            <Stat label="Medium" value={healthBuckets.medium} tone="amber" />
            <Stat label="Low" value={healthBuckets.low} tone="rose" />
            <Stat label="Unknown" value={healthBuckets.unknown} tone="neutral" />
          </div>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Recent job runs
          </h3>
          {jobs.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No runs recorded.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1">Job</th>
                  <th className="py-1">Status</th>
                  <th className="py-1 text-right">Rows</th>
                  <th className="py-1">Started</th>
                  <th className="py-1">Duration</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const dur =
                    j.finished_at && j.started_at
                      ? Math.round(
                          (new Date(j.finished_at).getTime() -
                            new Date(j.started_at).getTime()) / 1000,
                        )
                      : null
                  return (
                    <tr key={j.id} className="border-t border-neutral-100">
                      <td className="py-1 font-mono">{j.job}</td>
                      <td
                        className={`py-1 ${
                          j.status === 'success'
                            ? 'text-emerald-700'
                            : j.status === 'failed'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {j.status}
                      </td>
                      <td className="py-1 text-right tabular-nums text-neutral-700">
                        {j.rows_upserted ?? '—'}
                      </td>
                      <td className="py-1 tabular-nums text-neutral-500">
                        {new Date(j.started_at).toLocaleString()}
                      </td>
                      <td className="py-1 tabular-nums text-neutral-500">
                        {dur != null ? `${dur}s` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'emerald' | 'amber' | 'rose' | 'neutral'
}) {
  const bg =
    tone === 'emerald'
      ? 'bg-emerald-50 border-emerald-200'
      : tone === 'amber'
        ? 'bg-amber-50 border-amber-200'
        : tone === 'rose'
          ? 'bg-rose-50 border-rose-200'
          : 'bg-neutral-50 border-neutral-200'
  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className="text-[10px] uppercase tracking-wide text-neutral-600">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{value}</div>
    </div>
  )
}
