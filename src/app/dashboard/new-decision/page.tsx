'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Risk {
  risk: string
  severity: 'high' | 'medium' | 'low'
}

interface Alternative {
  option: string
  tradeoff: string
}

interface Analysis {
  summary: string
  top_risks: Risk[]
  alternatives: Alternative[]
  recommendation: string
  data_health_score: number
  confidence: number
}

export default function NewDecisionPage() {
  const router = useRouter()
  const supabase = createClient()

  const [title, setTitle] = useState('')
  const [proposal, setProposal] = useState('')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleAnalyse() {
    if (!title || !proposal) {
      setError('Title and proposal are required')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/analyze-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, proposal, context }),
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAnalysis(data.analysis)
    } catch (err) {
      setError('Analysis failed. Try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!analysis) return
    setSaving(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')

      const { error } = await supabase.from('decisions').insert({
        title,
        proposal,
        status: 'draft',
        created_by: user.id,
        ai_analysis: analysis,
        data_health_score: analysis.data_health_score,
      })

      if (error) throw error
      router.push('/dashboard')
    } catch (err) {
      setError('Failed to save. Try again.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const severityColor = (s: string) => {
    if (s === 'high') return 'bg-red-50 text-red-700 border-red-200'
    if (s === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200'
    return 'bg-green-50 text-green-700 border-green-200'
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-slate-500 hover:text-slate-900 text-sm"
          >
            ← Dashboard
          </button>
          <h1 className="text-lg font-semibold text-slate-900">
            New decision
          </h1>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="font-medium text-slate-900 mb-4">Decision details</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Reduce price of Product X in Mumbai"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Proposal
              </label>
              <textarea
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                placeholder="What are you proposing and why? Include the problem you are solving."
                rows={4}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Additional context
                <span className="text-slate-400 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Market data, competitor moves, financial context, constraints..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
              />
            </div>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            onClick={handleAnalyse}
            disabled={loading || !title || !proposal}
            className="mt-4 bg-slate-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Analysing...' : 'Analyse with AI'}
          </button>
        </div>

        {loading && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <div className="text-slate-400 text-sm">
              AI is analysing your decision...
            </div>
          </div>
        )}

        {analysis && !loading && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-slate-900">AI analysis</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    Data quality: {analysis.data_health_score}/100
                  </span>
                  <span className="text-xs text-slate-500">
                    Confidence: {analysis.confidence}/100
                  </span>
                </div>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {analysis.summary}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-medium text-slate-900 mb-3">Top risks</h3>
              <div className="space-y-2">
                {analysis.top_risks.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 px-3 py-2 rounded-lg border text-sm ${severityColor(r.severity)}`}
                  >
                    <span className="font-medium capitalize mt-0.5 shrink-0">
                      {r.severity}
                    </span>
                    <span>{r.risk}</span>
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
              <p className="text-sm text-slate-600 leading-relaxed">
                {analysis.recommendation}
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save decision to workspace'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}