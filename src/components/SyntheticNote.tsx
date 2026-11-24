'use client'

// "Demo data" banner, shown only while the deployment runs on the synthetic dataset.
// After a team imports its own data (app_settings.data_mode = 'custom') it disappears.
// One lightweight read per page load, shared by every instance on the page.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

let modePromise: Promise<string> | null = null
function dataMode(): Promise<string> {
  modePromise ??= (async () => {
    const { data } = await createClient().from('app_settings').select('value').eq('key', 'data_mode').maybeSingle()
    // No row / no table (pre-0018 database) can only mean the demo dataset.
    return data?.value ?? 'demo'
  })().catch(() => 'demo')
  return modePromise
}

export default function SyntheticNote() {
  const [mode, setMode] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void dataMode().then((m) => live && setMode(m))
    return () => {
      live = false
    }
  }, [])
  if (mode !== 'demo') return null
  return (
    <p className="text-xs text-slate-400 mt-1">
      Demo data is synthetic (Savora Foods).{' '}
      <Link href="/dashboard/data" className="underline hover:text-slate-600">
        Use your own data
      </Link>
    </p>
  )
}
