'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import TopNav from '@/components/TopNav'
import { SeverityPill, GroundedBadge, FactChip, SyntheticNote } from '@/components/decisionos'

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
    'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600'

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav email={email} />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <SyntheticNote />
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 mt-4">
          <h2 className="font-medium text-slate-900 mb-4">Decision details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Cut SC-001 Bhujia price 8% in West region" className={field} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={type} onChange={(e) => setType(e.target.value as DType)} className={field}>
                  <option>Strategic</option><option>Operational</option><option>Marketing</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Urgency</label>
                <select value={urgency} onChange={(e) => setUrgency(e.target.value as DUrgency)} className={field}>
                  <option>High</option><option>Medium</option><option>Low</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Proposal</label>
              <textarea value={proposal} onChange={(e) => setProposal(e.target.value)}
                placeholder="What are you proposing and why?" rows={4} className={`${field} resize-none`} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Additional context <span className="text-slate-400 font-normal ml-1">(optional)</span>
              </label>
              <textarea value={context} onChange={(e) => setContext(e.target.value)}
                placeholder="Market data, competitor moves, constraints..." rows={3} className={`${field} resize-none`} />
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button onClick={handleAnalyse} disabled={loading || !title || !proposal}
            className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Analysing...' : 'Analyse with AI'}
          </button>
        </div>

        {loading && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
            Retrieving facts, reasoning, cross-checking...
          </div>
        )}

        {analysis && !loading && (
          <div className="space-y-4">
            {!canSave && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                Analysis did not pass grounding validation and cannot be saved.
              </p>
            )}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="font-medium text-slate-900">Grounded analysis</h3>
                <GroundedBadge grounded={analysis.grounded} count={analysis.facts_used.length} />
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{analysis.summary}</p>
              <div className="mt-4 flex gap-3">
                <div className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Data health · computed</p>
                  <p className="text-lg font-semibold text-slate-900">{analysis.data_health_score}/100</p>
                </div>
                <div className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Confidence · computed</p>
                  <p className="text-lg font-semibold text-slate-900">{analysis.confidence}/100</p>
                </div>
              </div>
              {analysis.model && (
                <p className="mt-2 text-xs text-slate-400">Model: {analysis.model}</p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-medium text-slate-900 mb-3">Top risks</h3>
              <div className="space-y-2">
                {analysis.top_risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg border border-slate-200 text-sm">
                    <SeverityPill severity={r.severity} />
                    <span className="text-slate-700 flex-1">{r.risk}</span>
                    {r.fact_id && <FactChip id={r.fact_id} />}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-medium text-slate-900 mb-3">Alternatives considered</h3>
              <div className="space-y-3">
                {analysis.alternatives.map((a, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-slate-900">{a.option}</p>
                    <p className="text-xs text-slate-500 mt-1">{a.tradeoff}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-medium text-slate-900 mb-3">Recommendation</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{analysis.recommendation}</p>
            </div>

            {analysis.skeptic && (
              <div className={`rounded-xl border p-6 ${analysis.skeptic.disagrees ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <h3 className="font-medium text-slate-900 mb-1">
                  Skeptic cross-check — {analysis.skeptic.disagrees ? 'disagrees' : 'concurs'}
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed">{analysis.skeptic.refutation}</p>
              </div>
            )}

            {analysis.facts_used.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="font-medium text-slate-900 mb-3">Facts cited</h3>
                <ul className="space-y-1.5">
                  {analysis.facts_used.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-xs text-slate-600">
                      <FactChip id={f.id} />
                      <span className="font-medium">{f.metric}</span>
                      <span className="text-slate-400">= {String(f.value)}</span>
                      {f.window && <span className="text-slate-400">· {f.window}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button onClick={handleSave} disabled={saving || !canSave}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : canSave ? 'Save decision to workspace' : 'Save blocked — not grounded'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
