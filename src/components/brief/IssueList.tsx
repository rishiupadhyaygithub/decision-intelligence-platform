'use client'

// The "Needs a decision" list: ranked issues from buildBrief(). Rows rise in once on
// load (the page's one orchestrated motion); everything else is user-driven.

import { useState } from 'react'
import Link from 'next/link'
import type { Issue } from '@/lib/brief'
import Sparkline from './Sparkline'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'

const VISIBLE = 6

const TONE = {
  act: { bar: 'bg-act', text: 'text-act', label: 'Act now' },
  watch: { bar: 'bg-watch', text: 'text-watch', label: 'Watch' },
  good: { bar: 'bg-shelf', text: 'text-shelf', label: 'Going well' },
} as const

export default function IssueList({ issues, series }: { issues: Issue[]; series: Record<string, number[]> }) {
  const [openFact, setOpenFact] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (!issues.length) {
    return (
      <div className="rounded-2xl border border-line bg-white px-6 py-10 text-center">
        <p className="text-base font-medium text-slate-900">Nothing needs a decision this week</p>
        <p className="mt-1 text-sm text-slate-500">
          Every tracked product is above its reorder point and trading near its usual level.
        </p>
      </div>
    )
  }

  return (
    <>
      <ol className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
        {(showAll ? issues : issues.slice(0, VISIBLE)).map((issue, i) => {
          const t = TONE[issue.tone]
          const spark = issue.sku && issue.region ? series[`${issue.sku}|${issue.region}`] : undefined
          const href = `/dashboard/new-decision?title=${encodeURIComponent(issue.decide.title)}&proposal=${encodeURIComponent(issue.decide.proposal)}`
          return (
            <li
              key={issue.key}
              className="relative grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] items-center gap-x-6 gap-y-3 px-6 py-5 animate-rise hover:bg-slate-50/70 transition-colors"
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${t.bar}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${t.text}`}>{t.label}</p>
                <p className="mt-0.5 text-[15px] font-semibold text-slate-900 leading-snug">{issue.headline}</p>
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                  {issue.detail}{' '}
                  {issue.factIds.map((id, n) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setOpenFact(id)}
                      className="ml-0.5 align-baseline text-xs font-medium text-indigo-700 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-600"
                      title="Open the evidence behind this number"
                    >
                      evidence {issue.factIds.length > 1 ? n + 1 : ''}
                    </button>
                  ))}
                </p>
              </div>
              <div className="md:text-right">
                <p className={`num text-2xl font-semibold tracking-tight ${t.text}`}>{issue.figure}</p>
                <p className="text-xs text-slate-500">{issue.figureLabel}</p>
              </div>
              <div className="hidden md:block">
                {spark ? <Sparkline values={spark} tone={issue.tone} label={`Weekly units, last ${spark.length} weeks`} /> : <div className="w-28" />}
              </div>
              <Link
                href={href}
                className="justify-self-start md:justify-self-end rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:scale-[0.98] transition"
              >
                Decide
              </Link>
            </li>
          )
        })}
      </ol>
      {issues.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          {showAll ? 'Show fewer' : `Show ${issues.length - VISIBLE} more`}
        </button>
      )}
      {openFact && <LineageDrawer factId={openFact} onClose={() => setOpenFact(null)} />}
    </>
  )
}
