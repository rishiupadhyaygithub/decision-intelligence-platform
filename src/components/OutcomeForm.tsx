'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Client form that POSTs a measured outcome to /api/decisions/[id]/outcome.
// All numbers entered here are persisted as real rows; nothing is synthesized.
export default function OutcomeForm({ decisionId }: { decisionId: string }) {
  const router = useRouter()
  const [metric, setMetric] = useState('')
  const [predicted, setPredicted] = useState('')
  const [actual, setActual] = useState('')
  const [horizon, setHorizon] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/decisions/${decisionId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric: metric.trim(),
          predicted: Number(predicted),
          actual: Number(actual),
          ...(horizon.trim() ? { horizon: horizon.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? 'Failed to record outcome')
        return
      }
      setMetric('')
      setPredicted('')
      setActual('')
      setHorizon('')
      router.refresh()
    } catch {
      setError('Network error recording outcome')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Metric</label>
          <input
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            required
            placeholder="e.g. Revenue lift %"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Predicted</label>
          <input
            value={predicted}
            onChange={(e) => setPredicted(e.target.value)}
            required
            type="number"
            step="any"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Actual · measured</label>
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            required
            type="number"
            step="any"
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Horizon (optional)</label>
          <input
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            placeholder="e.g. 90 days"
            className={inputCls}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? 'Recording…' : 'Record outcome'}
      </button>
    </form>
  )
}
