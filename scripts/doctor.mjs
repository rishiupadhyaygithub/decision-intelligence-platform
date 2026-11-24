// scripts/doctor.mjs — is this install healthy? Prints PASS / WARN / FAIL per check
// and never prints a secret value. Exit code 1 if anything FAILs.
//   npm run doctor            (reads .env.local)
import { createClient } from '@supabase/supabase-js'

const results = []
const report = (level, check, detail) => results.push({ level, check, detail })
const env = (k) => (process.env[k] ?? '').trim()

// 1. Environment — names only.
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  report(env(k) ? 'PASS' : 'FAIL', `env ${k}`, env(k) ? 'set' : 'missing (see .env.example)')
}
report(env('GEMINI_API_KEY') ? 'PASS' : 'WARN', 'env GEMINI_API_KEY', env('GEMINI_API_KEY') ? 'set' : 'unset: analyses use the deterministic fallback only')
report(env('ADMIN_EMAILS') ? 'PASS' : 'WARN', 'env ADMIN_EMAILS', env('ADMIN_EMAILS') ? 'set' : 'unset: nobody can import data on the Data page')

const url = env('NEXT_PUBLIC_SUPABASE_URL')
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')

// 2. Database reachable + schema + freshness.
if (url && serviceKey) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const head = (table) => sb.from(table).select('*', { count: 'exact', head: true })
  try {
    const { error } = await head('facts')
    if (error) throw error
    report('PASS', 'database reachable', url.replace(/^https?:\/\//, ''))

    for (const t of ['sku', 'sales', 'inventory', 'competitor_signal', 'facts', 'decisions', 'decision_facts', 'job_runs', 'app_settings', 'api_rate_events']) {
      const { count, error: e } = await head(t)
      if (e) report('FAIL', `table ${t}`, `${e.message} — apply supabase/migrations in order`)
      else report('PASS', `table ${t}`, `${count} rows`)
    }

    const { data: mode } = await sb.from('app_settings').select('value').eq('key', 'data_mode').maybeSingle()
    report('PASS', 'data mode', mode?.value ?? 'demo (no app_settings row)')

    const { data: latest } = await sb.from('facts').select('computed_at').order('computed_at', { ascending: false }).limit(1).maybeSingle()
    if (!latest) report('FAIL', 'facts', 'no facts: run `npm run pipeline` (or import data on the Data page)')
    else {
      const hours = (Date.now() - Date.parse(latest.computed_at)) / 3.6e6
      // retriever.ts only grounds on facts from the last 14 days.
      const level = hours > 14 * 24 ? 'FAIL' : hours > 48 ? 'WARN' : 'PASS'
      report(level, 'facts freshness', `${hours.toFixed(0)}h old${level !== 'PASS' ? ' — run `npm run pipeline`; analyses ignore facts older than 14 days' : ''}`)
    }

    const { data: job } = await sb.from('job_runs').select('job,status,started_at,detail').order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (job) report(job.status === 'error' ? 'WARN' : 'PASS', 'last pipeline job', `${job.job} ${job.status} at ${job.started_at}${job.status === 'error' ? `: ${job.detail}` : ''}`)
  } catch (e) {
    const msg = String(e?.message ?? e)
    report('FAIL', 'database reachable', /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)
      ? 'no response. A free-plan Supabase project auto-pauses when idle: restore it in the dashboard. Otherwise check the URL.'
      : msg)
  }
}

// 3. LLM key works (lists models; costs no generation quota).
if (env('GEMINI_API_KEY')) {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': env('GEMINI_API_KEY') },
    })
    report(r.ok ? 'PASS' : 'FAIL', 'Gemini API key', r.ok ? 'accepted' : `HTTP ${r.status} — check the key`)
  } catch (e) {
    report('WARN', 'Gemini API key', `could not reach Google: ${e.message}`)
  }
}

const icon = { PASS: '✓', WARN: '!', FAIL: '✗' }
for (const r of results) console.log(`${icon[r.level]} ${r.level.padEnd(4)} ${r.check.padEnd(26)} ${r.detail}`)
const fails = results.filter((r) => r.level === 'FAIL').length
const warns = results.filter((r) => r.level === 'WARN').length
console.log(`\n${results.length - fails - warns} passed, ${warns} warnings, ${fails} failed`)
process.exit(fails ? 1 : 0)
