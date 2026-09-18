import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(url, key, { auth: { persistSession: false } })

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

async function debug() {
  const { data: velData } = await sb.from('v_sku_velocity').select('*').eq('sku_id', 'SC-001').eq('region', 'North')
  
  velData.sort((a, b) => new Date(a.week) - new Date(b.week))
  const u = velData.map((r) => Number(r.units))
  const last = u[u.length - 1]
  const prior = u.slice(0, -1)
  const delta = mean(prior) ? ((last - mean(prior)) / mean(prior)) * 100 : 0
  
  console.log("JS Logic:")
  console.log("Units array:", u)
  console.log("Last:", last, "Prior mean:", mean(prior), "Delta:", delta)
  
  const { data: sqlData } = await sb.from('v_fact_sku_velocity').select('*').eq('sku_id', 'SC-001').eq('region', 'North')
  console.log("SQL Output:")
  console.log(sqlData)
  
  // Let's run the raw SQL logic
  const { data: rawSql } = await sb.rpc('exec_sql', { sql: `
    WITH ranked AS (
        SELECT sku_id, region, units,
               row_number() over (partition by sku_id, region order by week desc) as rn
        FROM v_sku_velocity
        WHERE sku_id = 'SC-001' AND region = 'North'
    )
    SELECT rn, units FROM ranked ORDER BY rn;
  `}).catch(() => ({ data: 'RPC exec_sql not found' }))
  console.log("SQL Ranked rows:", rawSql)
}
debug().catch(console.error)
