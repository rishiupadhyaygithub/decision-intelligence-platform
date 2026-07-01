import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/TopNav'
import { SyntheticNote } from '@/components/decisionos'
import type { MemoryEntry } from '@/lib/types'

// Attribution / memory view. Reads real `memory` rows (RLS owner-via-decision).
// Every number shown comes from a persisted, code-written memory row — no placeholders.
export default async function MemoryView() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data } = await supabase
    .from('memory')
    .select('*')
    .order('decided_on', { ascending: false })
    .returns<MemoryEntry[]>()
  const memories = data ?? []

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav email={user.email} />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">
          ← Dashboard
        </Link>

        <div>
          <h1 className="text-xl font-semibold text-slate-900">Memory · attribution</h1>
          <p className="text-sm text-slate-500 mt-1">
            Closed decisions with their predicted vs actual outcome and the code-derived lesson.
          </p>
          <SyntheticNote />
        </div>

        {memories.length > 0 ? (
          <div className="space-y-3">
            {memories.map((m) => {
              const hasBoth = m.predicted !== null && m.actual !== null
              const delta = hasBoth ? (m.actual as number) - (m.predicted as number) : null
              return (
                <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      {m.decision_id ? (
                        <Link
                          href={`/dashboard/decisions/${m.decision_id}`}
                          className="font-medium text-slate-900 hover:text-indigo-600"
                        >
                          {m.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-900">{m.title}</span>
                      )}
                      {m.decided_on && (
                        <p className="text-xs text-slate-400 mt-0.5">Decided {m.decided_on}</p>
                      )}
                    </div>
                    {m.outcome && (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 capitalize">
                        {m.outcome}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-500">
                      predicted <span className="text-slate-900">{m.predicted ?? '—'}</span>
                    </span>
                    <span className="text-slate-500">
                      actual <span className="text-slate-900">{m.actual ?? '—'}</span>
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
                  </div>

                  {m.lesson && <p className="mt-3 text-sm text-slate-600 leading-relaxed">{m.lesson}</p>}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
            <p className="text-sm text-slate-500">No memory entries yet.</p>
            <p className="text-xs text-slate-400 mt-1">
              Lessons appear here once decisions are closed and outcomes are harvested.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
