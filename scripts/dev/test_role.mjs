import { createAdminClient } from '../../src/lib/supabase-admin.ts'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = URL_ ? new URL(URL_).hostname.split('.')[0] : null

async function applySQL(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return res.text()
}

async function testRole() {
  await applySQL(`
    CREATE OR REPLACE FUNCTION get_my_role() RETURNS text LANGUAGE plpgsql AS $$
    BEGIN
      RETURN current_setting('request.jwt.claim.role', true);
    END;
    $$;
  `)
  const { createClient } = await import('@supabase/supabase-js')
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const res = await anon.rpc('get_my_role')
  console.log('Anon Role:', res)
}
testRole()
