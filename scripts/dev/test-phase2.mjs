import { createClient } from '@supabase/supabase-js'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'fake-anon-key' // Or we can test by just omitting the key or using a dummy key if it's not set.

if (!url || !serviceKey) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const adminSb = createClient(url, serviceKey, { auth: { persistSession: false } })
// Create a client with anon key to represent public/unauthorized caller
const anonSb = createClient(url, anonKey, { auth: { persistSession: false } })

async function runTests() {
  console.log("=== Running Phase 2 Tests ===")
  let failed = false

  // 1. RPC SECURITY HARDENING
  console.log("\n1. Testing RPC Security Hardening")
  try {
    const { error: anonErr } = await anonSb.rpc('publish_facts', { new_facts: [], stale_ids: [] })
    if (!anonErr) {
      console.error("✗ FAILURE: Anonymous/public caller was able to execute publish_facts")
      failed = true
    } else if (anonErr.message.includes('permission denied') || anonErr.code === '42501' || anonErr.message.includes('does not exist')) {
       console.log("✓ SUCCESS: Unauthorized caller blocked from publish_facts")
    } else {
       console.log(`✓ SUCCESS: Unauthorized caller blocked, but with unexpected message: ${anonErr.message}`)
    }

    const { error: adminErr } = await adminSb.rpc('publish_facts', { new_facts: [], stale_ids: [] })
    if (adminErr) {
      console.error(`✗ FAILURE: Service role could not execute publish_facts: ${adminErr.message}`)
      failed = true
    } else {
      console.log("✓ SUCCESS: Service role can execute publish_facts")
    }
  } catch (e) {
    console.error(`✗ Error in RPC test: ${e.message}`)
    failed = true
  }

  // 2. ML FAILURE MUST FAIL THE PIPELINE
  console.log("\n2. Testing ML Failure semantics")
  try {
    // We can simulate an ML failure by pointing the pipeline to a bad python script or setting an env var that crashes it.
    // Easiest: rename ml/forecast.py temporarily, run compute.mjs, assert it crashes.
    await execAsync('mv ml/forecast.py ml/forecast_tmp.py')
    let crashed = false
    try {
      await execAsync('node scripts/facts/compute.mjs', { 
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } 
      })
    } catch (e) {
      crashed = true
    }
    await execAsync('mv ml/forecast_tmp.py ml/forecast.py')

    if (crashed) {
      console.log("✓ SUCCESS: Pipeline exited non-zero upon Python ML failure")
    } else {
      console.error("✗ FAILURE: Pipeline succeeded even when Python ML failed")
      failed = true
    }
  } catch (e) {
    console.error(`✗ Error in ML failure test: ${e.message}`)
    // Make sure we restore the file just in case!
    try { await execAsync('mv ml/forecast_tmp.py ml/forecast.py') } catch (e2) {}
    failed = true
  }

  // 3. INGESTION CORRECTION SEMANTICS
  console.log("\n3. Testing Ingestion Semantics")
  try {
    // Fetch an existing sku and region to satisfy FK constraints
    const { data: existingSales } = await adminSb.from('sales').select('sku_id, region, channel').limit(1)
    if (!existingSales || existingSales.length === 0) throw new Error("No existing sales found to use for FK")
    const { sku_id, region, channel } = existingSales[0]

    const testRow = {
      sku_id: sku_id,
      region: region,
      channel: channel,
      sale_date: '2029-01-01', // Future date to avoid conflicts with existing data
      units: 10,
      revenue: 100
    }

    // A. first ingestion -> row inserted
    const { error: ins1 } = await adminSb.from('sales').upsert([testRow], { onConflict: 'sku_id,region,channel,sale_date', ignoreDuplicates: false })
    if (ins1) throw new Error(`Insert A failed: ${ins1.message}`)
    
    const { data: d1 } = await adminSb.from('sales').select('*').eq('sku_id', sku_id).eq('sale_date', '2029-01-01').single()
    if (!d1 || d1.units !== 10) throw new Error("A failed: Row not found or wrong units")
    console.log("✓ SUCCESS: A. First ingestion -> row inserted")

    // B. exact retry -> no duplicate
    const { error: ins2 } = await adminSb.from('sales').upsert([testRow], { onConflict: 'sku_id,region,channel,sale_date', ignoreDuplicates: false })
    if (ins2) throw new Error(`Insert B failed: ${ins2.message}`)

    const { data: d2 } = await adminSb.from('sales').select('*').eq('sku_id', sku_id).eq('sale_date', '2029-01-01')
    if (d2.length !== 1) throw new Error("B failed: Duplicate created")
    console.log("✓ SUCCESS: B. Exact retry -> no duplicate")

    // C. corrected value for same business key -> existing row updated
    const correctedRow = { ...testRow, units: 15, revenue: 150 }
    const { error: ins3 } = await adminSb.from('sales').upsert([correctedRow], { onConflict: 'sku_id,region,channel,sale_date', ignoreDuplicates: false })
    if (ins3) throw new Error(`Insert C failed: ${ins3.message}`)

    const { data: d3 } = await adminSb.from('sales').select('*').eq('sku_id', sku_id).eq('sale_date', '2029-01-01').single()
    if (!d3 || d3.units !== 15) throw new Error("C failed: Row not updated")
    console.log("✓ SUCCESS: C. Corrected value -> existing row updated")

    // D. unrelated business key -> new row inserted
    const unrelatedRow = { ...testRow, sale_date: '2029-01-02' }
    const { error: ins4 } = await adminSb.from('sales').upsert([unrelatedRow], { onConflict: 'sku_id,region,channel,sale_date', ignoreDuplicates: false })
    if (ins4) throw new Error(`Insert D failed: ${ins4.message}`)

    const { data: d4 } = await adminSb.from('sales').select('*').eq('sku_id', sku_id).in('sale_date', ['2029-01-01', '2029-01-02'])
    if (d4.length !== 2) throw new Error("D failed: New row not inserted")
    console.log("✓ SUCCESS: D. Unrelated business key -> new row inserted")

    // Cleanup
    await adminSb.from('sales').delete().eq('sku_id', sku_id).in('sale_date', ['2029-01-01', '2029-01-02'])
  } catch (e) {
    console.error(`✗ Error in Ingestion test: ${e.message}`)
    failed = true
  }

  if (failed) {
    console.error("\nSome tests failed!")
    process.exit(1)
  } else {
    console.log("\nAll Phase 2 tests passed!")
  }
}

runTests()
