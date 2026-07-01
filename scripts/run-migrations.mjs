#!/usr/bin/env node
// Supabase preflight checker.
// Migrations are applied by scripts/apply-all.mjs or the Supabase SQL editor.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const projectRef = new URL(url).hostname.split('.')[0]

const tables = [
  'sku',
  'sales',
  'inventory',
  'competitor_signal',
  'facts',
  'decisions',
  'decision_enrichment',
  'decision_facts',
  'risks',
  'alternatives',
  'audit_log',
]
const views = [
  'v_revenue_daily',
  'v_revenue_by_region_daily',
  'v_sku_velocity',
  'v_region_demand',
  'v_margin',
  'v_inventory_risk',
  'v_competitor_pressure',
]

async function checkRelation(name) {
  const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true })
  if (error) return { name, ok: false, message: error.message }
  return { name, ok: true, count }
}

async function main() {
  console.log(`Supabase project: ${projectRef}`)

  let failed = false
  for (const group of [
    ['Tables', tables],
    ['Views', views],
  ]) {
    const [label, names] = group
    console.log(`\n${label}`)
    for (const name of names) {
      const result = await checkRelation(name)
      if (result.ok) {
        console.log(`  ✓ ${name}${typeof result.count === 'number' ? ` (${result.count})` : ''}`)
      } else {
        failed = true
        console.log(`  ✗ ${name}: ${result.message}`)
      }
    }
  }

  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
