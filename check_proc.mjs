import { createAdminClient } from './src/lib/supabase-admin.ts'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = URL_ ? new URL(URL_).hostname.split('.')[0] : null

async function check() {
  const sql = `SELECT prosrc FROM pg_proc WHERE proname = 'save_decision_lineage';`
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json()
  console.log(body[0]?.prosrc || 'Not found')
}
check()
