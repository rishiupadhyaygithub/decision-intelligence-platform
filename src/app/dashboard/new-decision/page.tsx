'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { SyntheticNote } from '@/components/decisionos'
import CitedText from '@/components/CitedText'
import EvidenceList from '@/components/EvidenceList'

interface Risk {
  risk: string
  severity: 'high' | 'medium' | 'low'
  fact_id: string | null
}
interface Alternative {
  option: string
  tradeoff: string
}
interface FactUsed {
  id: string
  metric: string
  value: number | string | null
  window: string | null
}
interface Analysis {
  summary: string
  top_risks: Risk[]
  alternatives: Alternative[]
  recommendation: string
  data_health_score: number
  confidence: number
  model?: string
  grounded: boolean
  facts_used: FactUsed[]
  lineage?: { claim_type: 'claim' | 'risk' | 'alternative'; claim_index: number; fact_id: string }[]
  skeptic: { disagrees: boolean; refutation: string } | null
  validation: { ok: boolean; violations: { token: string; reason: string }[] }
}

type DType = 'Strategic' | 'Operational' | 'Marketing'
type DUrgency = 'High' | 'Medium' | 'Low'

export default function NewDecisionPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState<string>()
  const [title, setTitle] = useState('')
  const [proposal, setProposal] = useState('')
  const [context, setContext] = useState('')
  const [type, setType] = useState<DType>('Strategic')
  const [urgency, setUrgency] = useState<DUrgency>('Medium')
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/auth/login')
      else setEmail(user.email)
    })
  }, [router, supabase.auth])

  // "Decide" on the Brief links here with the issue already written up.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const t = q.get('title')
    const p = q.get('proposal')
    if (t) setTitle(t.slice(0, 500))
    if (p) setProposal(p.slice(0, 5000))
  }, [])

  const canSave = analysis?.grounded && analysis?.validation.ok

  async function handleAnalyse() {
    if (!title || !proposal) {
      setError('Title and proposal are required')
      return
    }
    setError('')
    setAnalysis(null)
    setLoading(true)
    try {
      const res = await fetch('/api/analyze-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, proposal, context }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Analysis failed (${res.status})`)
      setAnalysis(data.analysis as Analysis)
      // results land below the form; bring them into view
      setTimeout(() => document.getElementById('analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!analysis || !canSave) return
    setSaving(true)
    setError('')
    try {
      const id =
        'd_' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)).replace(/-/g, '').slice(0, 12)

      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          title,
          type,
          urgency,
          problem: proposal,
          whynow: context,
          analysis,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      router.push(`/dashboard/decisions/${data.id ?? id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const field =
    'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20'

  const order = analysis?.facts_used.map((f) => f.id) ?? []
  const sevTone: Record<string, string> = { high: 'text-act', medium: 'text-watch', low: 'text-slate-500' }

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8 py-8 lg:py-12">
      <header>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">Ask a decision question</h1>
        <p className="mt-2 max-w-2xl text-base text-slate-600">
          Describe what you are weighing. It pulls the relevant numbers, drafts a recommendation, has a second model argue
          against it, and only shows claims it can back with your data.
        </p>
        <SyntheticNote />
      </header>

      <section className="mt-8 rounded-2xl border border-line bg-white p-6 sm:p-7">
        <div className="space-y-5">
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1.5">Decision</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Cut the price of Classic Chips by 8% in West" className={field} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1.5">What you are proposing, and why</span>
            <textarea value={proposal} onChange={(e) => setProposal(e.target.value)}
              placeholder="A rival is discounting in West and our volumes are slipping. Should we match?" rows={4} className={`${field} resize-y`} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr] gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value as DType)} className={field}>
                <option>Strategic</option><option>Operational</option><option>Marketing</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Urgency</span>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as DUrgency)} className={field}>
                <option>High</option><option>Medium</option><option>Low</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Extra context <span className="font-normal text-slate-400">(optional)</span></span>
              <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="Budget, deadlines, constraints" className={field} />
            </label>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button onClick={handleAnalyse} disabled={loading || !title || !proposal}
          className="mt-6 rounded-lg bg-indigo-600 px-6 py-2.5 text-[15px] font-medium text-white hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-50 transition">
          {loading ? 'Analysing…' : analysis ? 'Analyse again' : 'Analyse'}
        </button>
      </section>

      {loading && (
        <div className="mt-6 rounded-2xl border border-line bg-white p-7" role="status">
          <p className="text-sm font-medium text-slate-800">Working on it</p>
          <ol className="mt-3 space-y-2 text-sm text-slate-500">
            <li className="animate-rise">Pulling the numbers that matter for this question</li>
            <li className="animate-rise" style={{ animationDelay: '1.2s' }}>Drafting a recommendation from them</li>
            <li className="animate-rise" style={{ animationDelay: '2.4s' }}>Checking every claim against the data</li>
            <li className="animate-rise" style={{ animationDelay: '3.6s' }}>Asking a second model to argue the other side</li>
          </ol>
          <p className="mt-4 text-xs text-slate-400">Usually 15 to 40 seconds.</p>
        </div>
      )}

      {analysis && !loading && (
        <div id="analysis" className="mt-8 grid scroll-mt-6 grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-6">
            {!canSave && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Some claims could not be backed by the data, so this analysis cannot be saved. Try rephrasing with a product or region name.
              </p>
            )}
            <section className="rounded-2xl bg-ink p-7 text-slate-200 animate-rise">
              <h2 className="text-sm font-medium text-[#6fbfa4]">Recommendation</h2>
              <p className="mt-3 text-xl sm:text-2xl font-medium leading-snug text-white [&_button]:bg-white/10 [&_button]:text-white">
                <CitedText text={analysis.recommendation} order={order} />
              </p>
              <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/10 pt-5">
                <div>
                  <p className="num text-2xl font-semibold text-white">{analysis.confidence}<span className="text-base text-slate-400">/100</span></p>
                  <p className="text-xs text-slate-400">Confidence</p>
                </div>
                <div>
                  <p className="num text-2xl font-semibold text-white">{analysis.data_health_score}<span className="text-base text-slate-400">/100</span></p>
                  <p className="text-xs text-slate-400">Data quality behind it</p>
                </div>
                <div>
                  <p className="num text-2xl font-semibold text-white">{analysis.facts_used.length}</p>
                  <p className="text-xs text-slate-400">Pieces of evidence</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">Why</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-700"><CitedText text={analysis.summary} order={order} /></p>
            </section>

            {analysis.skeptic && (
              <section className={`rounded-2xl border p-6 ${analysis.skeptic.disagrees ? 'border-amber-200 bg-amber-50/60' : 'border-indigo-100 bg-indigo-50/50'}`}>
                <h2 className="text-base font-semibold text-slate-900">
                  {analysis.skeptic.disagrees ? 'A second model disagrees' : 'A second model agrees'}
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-700"><CitedText text={analysis.skeptic.refutation} order={order} /></p>
              </section>
            )}

            {analysis.top_risks.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">Risks</h2>
                <ul className="mt-3 space-y-3">
                  {analysis.top_risks.map((r, i) => (
                    <li key={i} className="flex gap-3">
                      <span className={`w-16 shrink-0 pt-0.5 text-xs font-semibold capitalize ${sevTone[r.severity] ?? 'text-slate-500'}`}>{r.severity}</span>
                      <p className="text-sm leading-relaxed text-slate-700"><CitedText text={r.risk} order={order} /></p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {analysis.alternatives.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">Other options considered</h2>
                <ul className="mt-3 divide-y divide-line">
                  {analysis.alternatives.map((a, i) => (
                    <li key={i} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium text-slate-900"><CitedText text={a.option} order={order} /></p>
                      <p className="mt-1 text-sm text-slate-500"><CitedText text={a.tradeoff} order={order} /></p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 self-start">
            {analysis.facts_used.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900">Evidence</h2>
                <div className="mt-2">
                  <EvidenceList
                    items={analysis.facts_used.map((f) => ({ fact_id: f.id, metric: f.metric, value: f.value, window: f.window, live: true, drifted_to: null, uses: 1 }))}
                  />
                </div>
              </section>
            )}
            <button onClick={handleSave} disabled={saving || !canSave}
              className="w-full rounded-xl bg-indigo-600 py-3 text-[15px] font-medium text-white hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-50 transition">
              {saving ? 'Saving…' : canSave ? 'Save decision' : 'Cannot save: not fully backed by data'}
            </button>
            {analysis.model && (
              <p className="px-1 text-xs text-slate-500">
                {analysis.model === 'deterministic-fallback' ? 'Drafted by the rule-based engine (the AI model was unavailable).' : `Drafted by ${analysis.model}.`}
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}
