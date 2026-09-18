import { createAdminClient } from '../../src/lib/supabase-admin.ts'
async function check() {
  const sb = createAdminClient()
  const { data } = await sb.from('decisions').select('*').eq('id', 'd_sec_test_A')
  console.log(data)
}
check()
