import { readFileSync } from 'node:fs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = URL_ ? new URL(URL_).hostname.split('.')[0] : null

async function applySQL(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  console.log('Status:', res.status)
  console.log('Body:', body)
}

applySQL(readFileSync('supabase/migrations/0014_phase4_security_freeze.sql', 'utf8'))
