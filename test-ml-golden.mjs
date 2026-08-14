import { createClient } from '@supabase/supabase-js'
import { computeMlFacts } from './scripts/facts/ml.mjs'
import { execSync } from 'child_process'
import fs from 'fs'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(url, key, { auth: { persistSession: false } })

async function dumpCsv() {
  const { data: vrd } = await sb.from('v_region_demand').select('*').limit(10000)
  fs.writeFileSync('v_region_demand.csv', ['region,month,units'].concat(vrd.map(r => `${r.region},${r.month},${r.units}`)).join('\n'))
  
  const { data: vsv } = await sb.from('v_sku_velocity').select('*').limit(10000)
  fs.writeFileSync('v_sku_velocity.csv', ['sku_id,region,week,units'].concat(vsv.map(r => `${r.sku_id},${r.region},${r.week},${r.units}`)).join('\n'))
}

async function run() {
  await dumpCsv()
  console.log("Generating JS ML facts...")
  const jsFacts = await computeMlFacts(sb)
  
  console.log("Running Python...")
  const env = { ...process.env }
  const pyFcStr = execSync('uv run --with pandas --with statsmodels --with scikit-learn ml/test_forecast.py', { encoding: 'utf-8', env })
  const pyChStr = execSync('uv run --with pandas --with statsmodels --with scikit-learn ml/test_churn.py', { encoding: 'utf-8', env })
  
  const pyFc = pyFcStr.split('\n').filter(l => l.startsWith('[')).map(l => JSON.parse(l))[0] || []
  const pyCh = pyChStr.split('\n').filter(l => l.startsWith('[')).map(l => JSON.parse(l))[0] || []

  console.log("\n--- FORECAST COMPARISON ---")
  const jsFc = jsFacts.filter(f => f.metric === 'demand_forecast_next')
  for (const js of jsFc) {
    const py = pyFc.find(p => p.dims.region === js.dims.region)
    if (!py) { console.log(`Missing Py for ${js.dims.region}`); continue; }
    const delta = Math.abs(js.value - py.value)
    console.log(`[${js.dims.region.padEnd(9)}] JS: ${js.value.toFixed(1).padEnd(6)} (c:${js.confidence.toFixed(2)}) | Py: ${py.value.toFixed(1).padEnd(6)} (c:${py.confidence.toFixed(2)}) | Delta: ${delta.toFixed(1)}`)
  }

  console.log("\n--- CHURN COMPARISON ---")
  const jsCh = jsFacts.filter(f => f.metric === 'churn_risk')
  for (const js of jsCh) {
    const py = pyCh.find(p => p.dims.sku === js.dims.sku && p.dims.region === js.dims.region)
    if (!py) { continue; }
    const delta = Math.abs(js.value - py.value)
    if (delta > 0.05) {
      console.log(`[${js.dims.sku} ${js.dims.region.padEnd(9)}] JS: ${js.value.toFixed(3)} | Py: ${py.value.toFixed(3)} | Delta: ${delta.toFixed(3)}`)
    }
  }
}

run().catch(console.error)
