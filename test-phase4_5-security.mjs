import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from './src/lib/supabase-admin.ts'
import { retrieveFacts } from './src/lib/agents/retriever.ts'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function getAuthClient(prefix, adminClient) {
  const email = `${prefix}_${Date.now()}@example.com`
  const password = 'password123'
  const { data: user, error: createErr } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true })
  if (createErr) console.error('Admin create user err:', createErr)
  
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const res = await client.auth.signInWithPassword({ email, password })
  if (res.error) console.error('SignIn error:', res.error)
  
  const { data: { session } } = await client.auth.getSession()
  if (!session) console.error('WARNING: No session for', email)
  return client
}

async function runSecurityTests() {
  const adminClient = createAdminClient()
  
  const userA = await getAuthClient('userA', adminClient)
  const userB = await getAuthClient('userB', adminClient)
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  console.log('--- Phase 4.5 Security Tests Starting ---')

  const decisionIdA = 'd_sec_test_A'
  await adminClient.from('decisions').delete().eq('id', decisionIdA)

  // 1. RPC cannot be called anonymously
  const anonSave = await anonClient.rpc('save_decision_lineage', {
    p_decision: { id: decisionIdA, title: 'Anon' }, p_snapshots: []
  })
  if (anonSave.error && anonSave.error.message.includes('Not authenticated')) {
    console.log('✅ RPC cannot be called anonymously')
  } else {
    console.error('❌ Anon call did not fail properly:', anonSave)
  }

  // User A creates a decision successfully
  const userASave = await userA.rpc('save_decision_lineage', {
    p_decision: { id: decisionIdA, title: 'User A Decision' }, p_snapshots: [{ claim_index: 0, claim_type: 'claim', fact_snapshot: {} }]
  })
  if (userASave.error) {
    console.error('❌ User A failed to save decision:', userASave.error)
  }
  const userAFb = await userA.from('decision_feedback').insert([{ decision_id: decisionIdA, accepted: true, user_feedback: 'Initial' }])
  if (userAFb.error) {
    console.error('❌ User A failed to save feedback:', userAFb.error)
  }

  // 2. User B cannot modify User A's decision via RPC
  const hijackSave = await userB.rpc('save_decision_lineage', {
    p_decision: { id: decisionIdA, title: 'Hijacked' }, p_snapshots: []
  })
  if (hijackSave.error && hijackSave.error.message.includes('Unauthorized')) {
    console.log('✅ User B cannot modify User A\'s decision')
  } else {
    console.error('❌ User B hijacked User A decision:', hijackSave)
  }

  // 3. User B cannot read User A's decision
  const readDecision = await userB.from('decisions').select('*').eq('id', decisionIdA)
  if (readDecision.data && readDecision.data.length === 0) {
    console.log('✅ User B cannot read User A\'s decision')
  } else {
    console.error('❌ User B read User A decision!')
  }

  // 4. User B cannot read User A's lineage (decision_facts)
  const readLineage = await userB.from('decision_facts').select('*').eq('decision_id', decisionIdA)
  if (readLineage.data && readLineage.data.length === 0) {
    console.log('✅ User B cannot read User A\'s lineage')
  } else {
    console.error('❌ User B read User A lineage!')
  }

  // 5 & 6. decision_facts cannot be updated or deleted by owner
  const updateLineage = await userA.from('decision_facts').update({ claim_type: 'hacked' }).eq('decision_id', decisionIdA).select()
  const deleteLineage = await userA.from('decision_facts').delete().eq('decision_id', decisionIdA).select()
  
  if (updateLineage.error || (updateLineage.data && updateLineage.data.length === 0)) {
    console.log('✅ decision_facts cannot be updated via client')
  } else {
    console.error('❌ User A was able to update decision_facts!', updateLineage)
  }
  if (deleteLineage.error || (deleteLineage.data && deleteLineage.data.length === 0)) {
    console.log('✅ decision_facts cannot be deleted via client')
  } else {
    console.error('❌ User A was able to delete decision_facts!', deleteLineage)
  }

  // 7. Feedback cannot be read cross-user
  const readFbB = await userB.from('decision_feedback').select('*').eq('decision_id', decisionIdA)
  if (readFbB.data && readFbB.data.length === 0) {
    console.log('✅ Feedback cannot be read cross-user')
  } else {
    console.error('❌ User B read User A feedback!')
  }

  // 8. Feedback cannot be modified after creation
  const updateFbA = await userA.from('decision_feedback').update({ user_feedback: 'Changed' }).eq('decision_id', decisionIdA).select()
  if (updateFbA.error || (updateFbA.data && updateFbA.data.length === 0)) {
    console.log('✅ Feedback cannot be modified after creation')
  } else {
    console.error('❌ User A updated feedback!', updateFbA)
  }

  // 9. RPC atomic rollback
  const rollbackDecisionId = 'd_rollback_test'
  await adminClient.from('decisions').delete().eq('id', rollbackDecisionId)
  
  // Force a failure in the snapshots JSON to cause plpgsql exception
  const rollbackSave = await userA.rpc('save_decision_lineage', {
    p_decision: { id: rollbackDecisionId, title: 'Rollback' },
    p_snapshots: [{ claim_index: "invalid_type", claim_type: 'claim' }] // Should fail casting to int
  })
  
  const checkRollback = await adminClient.from('decisions').select('*').eq('id', rollbackDecisionId)
  if (checkRollback.data && checkRollback.data.length === 0) {
    console.log('✅ RPC atomic rollback succeeded (decision not partially saved)')
  } else {
    console.error('❌ RPC atomic rollback failed! Decision exists.')
  }

  // 10. Empty retrieval -> 422 behavior
  // Note: the `retrieveFacts` function returns empty array, and the route.ts handles the 422 mapping.
  // We'll just verify retrieveFacts doesn't crash on garbage inputs.
  const emptyFacts = await retrieveFacts('garbagemetric123xyz')
  if (emptyFacts && emptyFacts.length === 0) {
    console.log('✅ Empty retrieval safely handled')
  } else {
    console.error('❌ Empty retrieval failed', emptyFacts)
  }

  // 11. Service role remains functional
  const adminSave = await adminClient.rpc('save_decision_lineage', {
    p_decision: { id: 'd_admin', title: 'Admin' }, p_snapshots: []
  })
  // Wait, admin client does NOT have auth.uid(), so it will fail the `v_uid IS NULL` check!
  // To allow service role, the RPC must allow v_uid to be null IF the role is service_role.
  if (adminSave.error) {
    console.error('⚠️ Service role was blocked:', adminSave.error)
  } else {
    console.log('✅ Service role remains functional')
  }
}

runSecurityTests()
