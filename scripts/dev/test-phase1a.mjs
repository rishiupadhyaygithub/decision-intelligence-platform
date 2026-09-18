import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(url, key, { auth: { persistSession: false } })

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const std = (a) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}

async function runTests() {
  console.log("--- SEMANTIC REGRESSION TEST ---")
  let passed = true

  // 1. revenue_trend_recent & revenue_anomaly_z
  const { data: revData } = await sb.from('v_revenue_by_region_daily').select('*')
  const byRegion = {}
  for (const r of revData) (byRegion[r.region] ??= []).push(r)
  const jsRev = {}
  for (const [region, rows] of Object.entries(byRegion)) {
    rows.sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date))
    const series = rows.map((r) => Number(r.revenue))
    if (series.length < 6) continue
    const recent = series.slice(-4)
    const base = series.slice(0, -4)
    const delta = mean(base) ? ((mean(recent) - mean(base)) / mean(base)) * 100 : 0
    const z = std(base) ? (mean(recent) - mean(base)) / std(base) : 0
    jsRev[region] = { delta, z, n: series.length }
  }

  const { data: sqlRev } = await sb.from('v_fact_revenue_trend').select('*')
  for (const sqlRow of sqlRev) {
    const js = jsRev[sqlRow.region]
    if (!js) { console.error(`SQL returned region ${sqlRow.region} missing in JS`); passed = false; continue; }
    const deltaDiff = Math.abs(js.delta - sqlRow.delta_pct)
    const zDiff = Math.abs(js.z - sqlRow.z_score)
    if (deltaDiff > 0.01 || zDiff > 0.01) {
      console.error(`Mismatch revenue [${sqlRow.region}]: JS(delta=${js.delta}, z=${js.z}) vs SQL(delta=${sqlRow.delta_pct}, z=${sqlRow.z_score})`)
      passed = false
    }
  }

  // 2. sku_velocity_delta
  const { data: velData } = await sb.from('v_sku_velocity').select('*')
  const byVel = {}
  for (const v of velData) {
    const k = `${v.sku_id}\0${v.region}`
    ;(byVel[k] ??= []).push(v)
  }
  const jsVel = {}
  for (const [k, rows] of Object.entries(byVel)) {
    const [sku, region] = k.split('\0')
    rows.sort((a, b) => new Date(a.week) - new Date(b.week))
    const u = rows.map((r) => Number(r.units))
    if (u.length < 4) continue
    const last = u[u.length - 1]
    const prior = u.slice(0, -1)
    const delta = mean(prior) ? ((last - mean(prior)) / mean(prior)) * 100 : 0
    jsVel[`${sku}-${region}`] = { delta, n: u.length }
  }

  const { data: sqlVel } = await sb.from('v_fact_sku_velocity').select('*')
  for (const sqlRow of sqlVel) {
    const js = jsVel[`${sqlRow.sku_id}-${sqlRow.region}`]
    if (!js) { console.error(`SQL returned ${sqlRow.sku_id}-${sqlRow.region} missing in JS`); passed = false; continue; }
    const deltaDiff = Math.abs(js.delta - sqlRow.delta_pct)
    if (deltaDiff > 0.01) {
      console.error(`Mismatch velocity [${sqlRow.sku_id}-${sqlRow.region}]: JS=${js.delta} vs SQL=${sqlRow.delta_pct}`)
      passed = false
    }
  }

  if (passed) console.log("✅ Semantic regression passed. SQL matches JS logic.")
  else console.log("❌ Semantic regression failed.")
}

runTests().catch(console.error)
