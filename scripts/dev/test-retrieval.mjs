import { createAdminClient } from '../../src/lib/supabase-admin.ts'
import { retrieveFacts } from '../../src/lib/agents/retriever.ts'

async function setupTestData() {
  const sb = createAdminClient()
  
  // Clear existing facts for clean test
  await sb.from('facts').delete().neq('id', 'dummy')
  
  const facts = []
  const now = new Date()
  
  // Insert 290 irrelevant facts (newer, higher health, but wrong metric/dims)
  for (let i = 0; i < 290; i++) {
    facts.push({
      id: `irrelevant_${i}`,
      metric: 'clicks',
      dims: { region: 'East' },
      value: 100,
      computed_at: new Date(now.getTime() - i * 1000).toISOString(),
      data_health: 0.9,
      unstable: false,
      method: 'test'
    })
  }
  
  // Insert 1 highly relevant fact, older so it's at the end of the 300 facts
  facts.push({
    id: 'relevant_target',
    metric: 'sales',
    dims: { region: 'West', sku: 'SKU123' },
    value: 500,
    computed_at: new Date(now.getTime() - 300000).toISOString(),
    data_health: 0.8,
    unstable: false,
    method: 'test'
  })
  
  const { error } = await sb.from('facts').insert(facts)
  if (error) {
    console.error("Failed to insert:", error)
    return false
  }
  return true
}

async function runTest() {
  console.log("Setting up 300 facts...")
  const ok = await setupTestData()
  if (!ok) return
  
  console.log("Retrieving facts for 'West SKU123 sales'...")
  const results = await retrieveFacts('West SKU123 sales')
  
  console.log(`Retrieved ${results.length} facts`)
  if (results.some(f => f.id === 'relevant_target')) {
    console.log("✅ target fact found!")
  } else {
    console.log("❌ target fact NOT found!")
  }
  
  console.log("IDs retrieved:", results.map(f => f.id))
}

runTest()
