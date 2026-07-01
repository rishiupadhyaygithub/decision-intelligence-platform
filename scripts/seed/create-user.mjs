// One-shot: create a pre-confirmed auth user (bypasses email confirmation).
// Run: node --env-file=.env.local scripts/seed/create-user.mjs <email> <password>
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const email = process.argv[2] || 'demo@dip.os'
const password = process.argv[3] || 'demo-pass-1234'

const sb = createClient(url, key, { auth: { persistSession: false } })
const { data, error } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // mark confirmed so sign-in works immediately
})
if (error) {
  console.error('createUser failed:', error.message)
  process.exit(1)
}
console.log('Created confirmed user:', data.user.email, '(id', data.user.id + ')')
console.log('Login with:', email, '/', password)
