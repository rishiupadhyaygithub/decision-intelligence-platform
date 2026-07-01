// scripts/pipeline/run.mjs
// Orchestration backbone. Runs the pipeline stages in order and logs each to the
// job_runs table (= the dashboard "System health" panel). Designed to run on a
// schedule from GitHub Actions (free) OR locally:
//   node --env-file=.env.local scripts/pipeline/run.mjs
//
// Stages (v1): ingest market data -> recompute facts (ML retrains every run).
// Eval + memory-sweep stages will hang off the same runner once the TS pipeline
// is runnable in CI.
import { createClient } from '@supabase/supabase-js'
import { computeFacts } from '../facts/compute.mjs'
import { ingestMarketData } from './ingest.mjs'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

async function logStart(job) {
  const { data } = await sb.from('job_runs').insert({ job, status: 'running' }).select('id').single()
  return data?.id ?? null
}
async function logEnd(id, status, rows, detail, startedMs) {
  if (id == null) return
  await sb
    .from('job_runs')
    .update({
      status,
      rows_affected: rows ?? null,
      detail: detail ? String(detail).slice(0, 500) : null,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
    })
    .eq('id', id)
}

// Run one named stage with timing + job_runs logging. Returns ok boolean.
async function stage(job, fn) {
  const t0 = Date.now()
  const id = await logStart(job)
  try {
    const rows = await fn()
    await logEnd(id, 'ok', rows, `ok`, t0)
    console.log(`✓ ${job}: ${rows} rows (${Date.now() - t0}ms)`)
    return true
  } catch (e) {
    await logEnd(id, 'error', null, e.message || String(e), t0)
    console.error(`✗ ${job}: ${e.message || e}`)
    return false
  }
}

async function main() {
  const okIngest = await stage('ingest', () => ingestMarketData(sb))
  // Always recompute facts even if ingest failed — keeps facts consistent.
  const okFacts = await stage('facts', () => computeFacts(sb))
  if (!okIngest || !okFacts) process.exit(1)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
