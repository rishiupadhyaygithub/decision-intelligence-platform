'use client'

// Renders model text with [fact_id] citations as small numbered references that open
// the evidence drawer, instead of raw ids like [f_db100492c56d0299] in the prose.
// `order` fixes the numbering so the same fact has the same number across a page.

import { useState } from 'react'
import { LineageDrawer } from '@/components/lineage/LineageDrawer'

const CITE = /\[(f_[a-zA-Z0-9_:-]+)\]/g

export default function CitedText({ text, order = [], className }: { text: string | null | undefined; order?: string[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!text) return null

  const numbers = new Map(order.map((id, i) => [id, i + 1]))
  const parts: (string | { id: string; n: number })[] = []
  let last = 0
  for (const m of text.matchAll(CITE)) {
    const id = m[1]
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1)
    // drop the space the model put before the bracket; the marker sits on the word
    parts.push(text.slice(last, m.index).replace(/\s+$/, ''))
    parts.push({ id, n: numbers.get(id)! })
    last = m.index! + m[0].length
  }
  parts.push(text.slice(last))

  return (
    <>
      <span className={className}>
        {parts.map((p, i) =>
          typeof p === 'string' ? (
            <span key={i}>{p}</span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => setOpen(p.id)}
              title="Open the evidence behind this"
              className="num mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-md bg-indigo-50 px-1 text-[11px] font-semibold text-indigo-700 align-middle hover:bg-indigo-100 transition-colors"
            >
              {p.n}
            </button>
          ),
        )}
      </span>
      {open && <LineageDrawer factId={open} onClose={() => setOpen(null)} />}
    </>
  )
}
