// W6.3 — Decision Inbox.
// Open decisions sorted by urgency band + created_at. Links straight into
// the layered detail page. Server component — no client hydration overhead.

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/TopNav'

type Decision = {
  id: string
  title: string
  type: string
  urgency: string
  status: string
  proposer: string | null
  created_at: string
}

const URGENCY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
const URGENCY_STYLE: Record<string, string> = {
  High: 'bg-rose-100 text-rose-800',
  Medium: 'bg-amber-100 text-amber-800',
  Low: 'bg-emerald-100 text-emerald-800',
}
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-neutral-200 text-neutral-800',
  review: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  executing: 'bg-indigo-100 text-indigo-800',
  measured: 'bg-neutral-100 text-neutral-500',
}

export default async function InboxPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data, error } = await supabase
    .from('decisions')
    .select('id, title, type, urgency, status, proposer, created_at')
    .in('status', ['pending', 'review', 'approved', 'executing'])
    .order('created_at', { ascending: false })
    .limit(100)

  const decisions = (data ?? []) as Decision[]
  decisions.sort((a, b) => {
    const ru = (URGENCY_RANK[a.urgency] ?? 3) - (URGENCY_RANK[b.urgency] ?? 3)
    if (ru !== 0) return ru
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const byUrgency = { High: 0, Medium: 0, Low: 0 } as Record<string, number>
  for (const d of decisions) byUrgency[d.urgency] = (byUrgency[d.urgency] ?? 0) + 1

  return (
    <div className="min-h-screen bg-neutral-50">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Decision Inbox</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Open decisions across the org. High urgency floats to the top.
            </p>
          </div>
          <Link
            href="/dashboard/new-decision"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + New decision
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="High urgency" value={byUrgency.High ?? 0} tone="rose" />
          <Stat label="Medium urgency" value={byUrgency.Medium ?? 0} tone="amber" />
          <Stat label="Low urgency" value={byUrgency.Low ?? 0} tone="emerald" />
        </div>

        {error ? (
          <div className="mt-6 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error.message}
          </div>
        ) : null}

        <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Urgency</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Proposer</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {decisions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                    Nothing open. Nice.
                  </td>
                </tr>
              ) : (
                decisions.map((d) => (
                  <tr key={d.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/dashboard/decisions/${d.id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-neutral-700">{d.type}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          URGENCY_STYLE[d.urgency] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {d.urgency}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLE[d.status] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-700">{d.proposer ?? '—'}</td>
                    <td className="px-4 py-2 tabular-nums text-neutral-500">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
  tone: 'rose' | 'amber' | 'emerald'
}) {
  const bg =
    tone === 'rose'
      ? 'bg-rose-50 border-rose-200'
      : tone === 'amber'
        ? 'bg-amber-50 border-amber-200'
        : 'bg-emerald-50 border-emerald-200'
  return (
    <div className={`rounded-lg border p-4 ${bg}`}>
      <div className="text-xs uppercase tracking-wide text-neutral-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</div>
    </div>
  )
}
