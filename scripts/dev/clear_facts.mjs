import { createAdminClient } from '../../src/lib/supabase-admin.ts'
const sb = createAdminClient()
await sb.from('decision_facts').delete().neq('fact_id', 'dummy')
console.log('Cleared decision_facts')
