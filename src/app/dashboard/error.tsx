'use client'

// Route-level error boundary for /dashboard. Without it, a runtime error in any panel
// (e.g. a null value reaching .toFixed()) blanks the whole page with Next's default screen.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border border-rose-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">This view failed to render</h2>
        <p className="mt-2 text-sm text-slate-600">
          Something in this panel hit an unexpected value. Your data is unchanged.
        </p>
        {error.digest && <p className="mt-2 text-xs font-mono text-slate-400">ref: {error.digest}</p>}
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
