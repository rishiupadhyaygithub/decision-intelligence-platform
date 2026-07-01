import Link from 'next/link'
import type { ReactNode } from 'react'

// Pure presentational primitives — usable in both server and client components.

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-slate-900">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white text-[11px]">
        DO
      </span>
      DecisionOS
    </Link>
  )
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export function SeverityPill({ severity }: { severity: string }) {
  const c =
    severity === 'high'
      ? 'bg-red-50 text-red-700 border-red-200'
      : severity === 'medium'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return (
    <span className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full border ${c}`}>
      {severity}
    </span>
  )
}

export function GroundedBadge({ grounded, count }: { grounded: boolean; count: number }) {
  return grounded ? (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      ● Grounded · {count} fact{count !== 1 ? 's' : ''}
    </span>
  ) : (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      ● Ungrounded — no matching facts
    </span>
  )
}

export function FactChip({ id }: { id: string }) {
  return (
    <code className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
      {id}
    </code>
  )
}

export function Gauge({ value, label }: { value: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  const r = 30
  const circ = 2 * Math.PI * r
  const dash = (v / 100) * circ
  const color = v >= 70 ? '#10b981' : v >= 40 ? '#6366f1' : '#f59e0b'
  return (
    <div className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-3 flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 36 36)"
        />
        <text x="36" y="40" textAnchor="middle" className="fill-slate-900" fontSize="16" fontWeight="600">
          {value ?? '—'}
        </text>
      </svg>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xs text-slate-500">computed · /100</p>
      </div>
    </div>
  )
}

export function SyntheticNote() {
  return <p className="text-xs text-slate-400 mt-1">Demo data is synthetic (Savora Foods). Not live.</p>
}
