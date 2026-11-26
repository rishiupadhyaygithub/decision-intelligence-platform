'use client'

// Bring-your-own-data UI: status of the current dataset, CSV backups, and a
// validate-then-confirm import. Validation runs server-side and writes nothing; the
// import is a single transaction (0018) followed by a facts recompute.

import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/decisionos'

const DATASETS = [
  { key: 'skus', label: 'Products (skus.csv)', required: true, cols: 'sku_id,name,category,mrp,unit_cost,launched_on' },
  { key: 'sales', label: 'Sales (sales.csv)', required: true, cols: 'sku_id,region,channel,sale_date,units,revenue' },
  { key: 'inventory', label: 'Inventory (inventory.csv)', required: false, cols: 'sku_id,region,snapshot_date,on_hand,reorder_point' },
  { key: 'signals', label: 'Market signals (signals.csv)', required: false, cols: 'source,category,body,impact,detected_at,urgent' },
] as const
type Key = (typeof DATASETS)[number]['key']

interface Status {
  data_mode: 'demo' | 'custom'
  data_mode_since: string | null
  counts: Record<Key | 'facts', number>
  facts_computed_at: string | null
  latest_sale_date: string | null
  recent_jobs: { job: string; status: string; started_at: string; detail: string | null }[]
  can_import: boolean
  admin_configured: boolean
}
interface Result {
  ok?: boolean
  mode?: string
  counts?: Record<Key, number>
  errors?: { dataset: string; row: number; column: string; message: string }[]
  error_count?: number
  warnings?: string[]
  imported?: Record<string, number>
  facts_computed?: number | null
  facts_error?: string | null
  error?: string
}

const card = 'rounded-2xl border border-line bg-white p-6'
const COUNT_LABEL = { skus: 'Products', sales: 'Weekly sales rows', inventory: 'Stock counts', signals: 'Market signals', facts: 'Computed facts' } as const
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

export default function DataManager() {
  const [status, setStatus] = useState<Status | null>(null)
  const [statusErr, setStatusErr] = useState('')
  const [files, setFiles] = useState<Partial<Record<Key, File>>>({})
  const [busy, setBusy] = useState<'' | 'validate' | 'import'>('')
  const [result, setResult] = useState<Result | null>(null)
  const [validatedFor, setValidatedFor] = useState('')
  const [confirm, setConfirm] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/data/status')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setStatus(await r.json())
      setStatusErr('')
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'failed')
    }
  }, [])
  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  // A validation result only counts for the exact files it checked.
  const fingerprint = DATASETS.map((d) => (files[d.key] ? `${d.key}:${files[d.key]!.name}:${files[d.key]!.size}:${files[d.key]!.lastModified}` : '')).join('|')
  const validated = result?.ok === true && result.mode === 'validate' && validatedFor === fingerprint

  async function send(mode: 'validate' | 'import') {
    setBusy(mode)
    if (mode === 'validate') setResult(null)
    try {
      const fd = new FormData()
      fd.set('mode', mode)
      if (mode === 'import') fd.set('confirm', confirm)
      for (const d of DATASETS) if (files[d.key]) fd.set(d.key, files[d.key]!)
      const r = await fetch('/api/data/import', { method: 'POST', body: fd })
      const j: Result = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      setResult(j)
      if (mode === 'validate') setValidatedFor(fingerprint)
      if (mode === 'import' && r.ok) {
        setFiles({})
        setConfirm('')
        setValidatedFor('')
        await loadStatus()
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setBusy('')
    }
  }

  if (statusErr) return <div className={`${card} text-sm text-rose-700`}>Could not load data status: {statusErr}</div>
  if (!status) return <Skeleton rows={3} label="Loading data status" />

  const demo = status.data_mode === 'demo'
  return (
    <>
      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">What the app is using now</h2>
          <span
            className={`text-xs rounded px-2 py-0.5 border ${
              demo ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            {demo ? 'Demo data (synthetic)' : `Your data · since ${fmt(status.data_mode_since)}`}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          {(['skus', 'sales', 'inventory', 'signals', 'facts'] as const).map((k) => (
            <div key={k} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">{COUNT_LABEL[k]}</dt>
              <dd className="font-medium text-slate-900">{status.counts[k].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Facts last computed {fmt(status.facts_computed_at)} · latest sale {status.latest_sale_date ?? '—'}
        </p>
        {status.recent_jobs[0]?.status === 'error' && (
          <p className="mt-2 text-xs text-rose-700">
            Last pipeline job ({status.recent_jobs[0].job}) failed: {status.recent_jobs[0].detail}
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-slate-900">Step 1. Download a backup</h2>
        <p className="text-sm text-slate-500 mt-1">
          One CSV per table, already in the import format. Keep these before replacing anything; they also show exactly how your own files should look.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DATASETS.map((d) => (
            <a
              key={d.key}
              href={`/api/data/export?dataset=${d.key}`}
              className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              {d.key}.csv
            </a>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-slate-900">Step 2. Check your files, then replace</h2>
        {!status.can_import ? (
          <p className="mt-2 text-sm text-slate-600">
            {status.admin_configured
              ? 'Only admins can replace the data. Ask whoever runs this app to add your email to ADMIN_EMAILS.'
              : 'Importing is turned off. To turn it on, add your email to ADMIN_EMAILS in .env.local (comma-separated for several people) and restart the app.'}
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500 mt-1">
              UTF-8 CSV with a header row. Dates as YYYY-MM-DD. Sample files:{' '}
              {DATASETS.map((d, i) => (
                <span key={d.key}>
                  <a className="text-indigo-600 hover:underline" href={`/samples/${d.key}.csv`} download>
                    {d.key}
                  </a>
                  {i < DATASETS.length - 1 ? ', ' : ''}
                </span>
              ))}
              .
            </p>
            <div className="mt-4 space-y-3">
              {DATASETS.map((d) => (
                <label key={d.key} className="block">
                  <span className="text-sm text-slate-700">
                    {d.label} {d.required ? <span className="text-rose-600">*</span> : <span className="text-slate-400">(optional)</span>}
                  </span>
                  <span className="block text-[11px] font-mono text-slate-400">{d.cols}</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="mt-1 block text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
                    onChange={(e) => setFiles((f) => ({ ...f, [d.key]: e.target.files?.[0] }))}
                  />
                </label>
              ))}
            </div>
            <button
              onClick={() => send('validate')}
              disabled={!files.skus || !files.sales || busy !== ''}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === 'validate' ? 'Checking…' : 'Check files'}
            </button>
          </>
        )}

        {result && (
          <div className="mt-5 space-y-3 text-sm">
            {result.error && <p className="text-rose-700">{result.error}</p>}
            {result.counts && (
              <p className="text-slate-600">
                Rows read: {Object.entries(result.counts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}
              </p>
            )}
            {!!result.errors?.length && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="font-medium text-rose-800">
                  {result.error_count} problem{result.error_count === 1 ? '' : 's'} found. Nothing was imported.
                  {result.error_count! > result.errors.length ? ` Showing the first ${result.errors.length}.` : ''}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-rose-800 font-mono">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.dataset}.csv{e.row ? ` row ${e.row}` : ''} [{e.column}]: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!result.warnings?.length && (
              <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            {result.imported && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
                Imported {Object.entries(result.imported).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(', ')}.{' '}
                {result.facts_error ?? `${result.facts_computed ?? 0} facts computed. Dashboards and analyses now use your data.`}
              </div>
            )}
          </div>
        )}

        {validated && (
          <div className="mt-5 rounded-lg border border-slate-300 p-4">
            <p className="text-sm text-slate-800 font-medium">Replace the current dataset?</p>
            <p className="text-xs text-slate-500 mt-1">
              All products, sales, inventory and signals are deleted and replaced in one step. Decisions keep the values
              they cited. There is no undo: download a backup above first (it re-imports as-is).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type REPLACE"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => send('import')}
                disabled={confirm !== 'REPLACE' || busy !== ''}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy === 'import' ? 'Importing and recomputing…' : 'Replace dataset'}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
