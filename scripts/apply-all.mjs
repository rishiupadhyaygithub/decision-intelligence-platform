#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { computeFacts } from './facts/compute.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = URL_ ? new URL(URL_).hostname.split('.')[0] : null

function sb() {
  return createClient(URL_, SVC, { auth: { persistSession: false } })
}

async function applySQL(sql, label) {
  console.log(`\n  ▶ ${label}`)
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    const msg = body.error || body.message || JSON.stringify(body).slice(0, 300)
    if (/already exists/i.test(String(msg))) {
      console.log('     already exists — OK')
      return true
    }
    console.error(`  ✗  ${msg}`)
    return false
  }
  console.log('     ✓ done')
  return true
}

async function runMigrations() {
  console.log('\n═══ STEP 1 — Schema migrations ═══')
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  let ok = true
  for (const file of files) {
    if (!(await applySQL(readFileSync(`supabase/migrations/${file}`, 'utf8'), file))) ok = false
  }
  return ok
}

async function runSeed() {
  console.log('\n═══ STEP 2 — Seed data ═══')
  const client = sb()
  const force = process.env.FORCE_SEED === '1'
  const { count: sigCount, error: countError } = await client
    .from('competitor_signal')
    .select('*', { count: 'exact', head: true })
  if (countError) {
    console.error(`  ✗ ${countError.message}`)
    return false
  }
  if (!force && sigCount && sigCount > 0) {
    const { count: salesCount } = await client.from('sales').select('*', { count: 'exact', head: true })
    if (salesCount && salesCount > 0) {
      console.log(`  ✓ Already seeded (${sigCount} signals, ${salesCount} sales) — skipping`)
      return true
    }
    console.log('  ! Partial seed — reloading')
  }
  if (!(await applySQL(readFileSync('scripts/seed/savora_seed.sql', 'utf8'), 'savora_seed.sql'))) return false
  for (const table of ['sku', 'sales', 'inventory', 'competitor_signal']) {
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
    if (error) {
      console.error(`  ✗ ${table}: ${error.message}`)
      return false
    }
    console.log(`  ✓ ${table}: ${count} rows`)
  }
  return true
}

async function runFacts() {
  console.log('\n═══ STEP 3 — Compute facts ═══')
  try {
    const n = await computeFacts(sb())
    console.log(`  ✓ Upserted ${n} facts`)
    return true
  } catch (e) {
    console.error(`  ✗ ${e.message || e}`)
    return false
  }
}

async function main() {
  console.log(`DecisionOS Go-Live — project ${REF}`)
  if (!TOKEN || !SVC || !URL_) {
    console.error('Need SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL')
    process.exit(1)
  }
  if (!(await runMigrations())) process.exit(1)
  if (!(await runSeed())) process.exit(1)
  if (!(await runFacts())) process.exit(1)
  console.log('\n✅ ALL DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
