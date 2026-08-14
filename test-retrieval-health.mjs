import { createAdminClient } from './src/lib/supabase-admin.ts'
import { retrieveFacts } from './src/lib/agents/retriever.ts'

async function setupTestData() {
  const sb = createAdminClient()
  await sb.from('facts').delete().neq('id', 'dummy')
  
  const now = new Date()
  const fresh = now.toISOString()
  const stale = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days old
  
  const facts = [
    // 1. healthy + fresh -> should be retrieved
    { id: 'f_healthy_fresh', metric: 'sales', dims: { test: 'consistency' }, value: 100, computed_at: fresh, data_health: 0.9, unstable: false, method: 'test' },
    // 2. unhealthy + fresh -> should be ignored (health 0.4 < 0.5)
    { id: 'f_unhealthy_fresh', metric: 'sales', dims: { test: 'consistency' }, value: 100, computed_at: fresh, data_health: 0.4, unstable: false, method: 'test' },
    // 3. healthy + stale -> should be ignored (older than 2 weeks)
    { id: 'f_healthy_stale', metric: 'sales', dims: { test: 'consistency' }, value: 100, computed_at: stale, data_health: 0.9, unstable: false, method: 'test' },
    // 4. unstable -> should be ignored
    { id: 'f_unstable', metric: 'sales', dims: { test: 'consistency' }, value: 100, computed_at: fresh, data_health: 0.9, unstable: true, method: 'test' }
  ]
  
  const { error } = await sb.from('facts').insert(facts)
  if (error) console.error("Failed to insert:", error)
}

async function runTest() {
  await setupTestData()
  
  const results = await retrieveFacts('consistency sales')
  console.log("Retrieved IDs:", results.map(f => f.id))
  
  // Clean up and test "all invalid"
  const sb = createAdminClient()
  await sb.from('facts').delete().eq('id', 'f_healthy_fresh')
  
  const resultsEmpty = await retrieveFacts('consistency sales')
  console.log("Empty retrieval check:", resultsEmpty.length === 0 ? "PASSED (empty)" : "FAILED (not empty)")
}

runTest()
