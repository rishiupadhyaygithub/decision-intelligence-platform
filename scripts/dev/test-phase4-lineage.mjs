import { createAdminClient } from '../../src/lib/supabase-admin.ts'

async function runTests() {
  const sb = createAdminClient()

  // Setup: create some facts
  const facts = [
    { id: 'f_x', metric: 'm_x', value: 10, method: 'test', formula_id: 'rev_v1' },
    { id: 'f_y', metric: 'm_y', value: 20, method: 'test', formula_id: 'rev_v1' }
  ]
  await sb.from('facts').delete().in('id', ['f_x', 'f_y'])
  await sb.from('facts').insert(facts)

  const decisionId = 'd_test_lineage'
  await sb.from('decisions').delete().eq('id', decisionId)

  // Simulate API saving a decision
  const decisionObj = {
    id: decisionId,
    title: 'Test Lineage',
    problem: 'Test Problem',
  }
  const snapshots = [
    // T4: Multiple claims
    { claim_index: 0, claim_type: 'claim', fact_id: 'f_x', fact_snapshot: facts[0] },
    { claim_index: 1, claim_type: 'claim', fact_id: 'f_y', fact_snapshot: facts[1] },
    // T5: Duplicate evidence
    { claim_index: 2, claim_type: 'claim', fact_id: 'f_x', fact_snapshot: facts[0] }, 
  ]

  const { error: saveErr } = await sb.rpc('save_decision_lineage', {
    p_decision: decisionObj,
    p_snapshots: snapshots
  })
  if (saveErr) {
    console.error('Save failed:', saveErr)
    return
  }
  
  // T4 & T5 verification
  const { data: dFacts } = await sb.from('decision_facts').select('*').eq('decision_id', decisionId)
  
  if (dFacts.length === 3) {
    console.log("✅ T4 & T5 passed: 3 snapshot records exist, allowing duplicate evidence usage deterministically.")
  } else {
    console.error("❌ T4/T5 failed. Expected 3 records, got:", dFacts.length)
  }

  // T7: Formula evolution
  await sb.from('facts').update({ formula_id: 'rev_v2' }).eq('id', 'f_x')
  
  const { data: lineageData } = await sb.from('decision_facts').select('*').eq('decision_id', decisionId).eq('claim_index', 0).single()
  
  if (lineageData.fact_snapshot.formula_id === 'rev_v1') {
    console.log("✅ T7 passed: Formula evolution did not alter historical snapshot.")
  } else {
    console.error("❌ T7 failed. Snapshot mutated.")
  }

  // T6: Deleted live fact
  await sb.from('facts').delete().eq('id', 'f_x')

  const { data: lineageDataAfterDelete } = await sb.from('decision_facts').select('*').eq('decision_id', decisionId).eq('claim_index', 0).single()
  if (lineageDataAfterDelete && lineageDataAfterDelete.fact_snapshot.metric === 'm_x') {
    console.log("✅ T6 passed: Deleted live fact did not destroy lineage snapshot (fact_id reference becomes null or dangling but snapshot remains).")
  } else {
    console.error("❌ T6 failed. Snapshot lost.")
  }

  console.log("Lineage testing complete.")
}

runTests()
