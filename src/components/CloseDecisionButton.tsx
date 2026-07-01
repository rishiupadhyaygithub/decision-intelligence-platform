'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Closes a decision and triggers memory harvest. Requires >=1 recorded outcome
// (the API returns 409 otherwise). Memory is computed server-side in code.
export default function CloseDecisionButton({ decisionId }: { decisionId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function close() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/decisions/${decisionId}/close`, { method: 'POST' })
    const body = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(body?.error ?? 'Failed to close decision')
      return
    }
    router.refresh()
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <button
        onClick={close}
        disabled={busy}
        className="text-sm font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? 'Closing…' : 'Close decision & harvest memory'}
      </button>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
