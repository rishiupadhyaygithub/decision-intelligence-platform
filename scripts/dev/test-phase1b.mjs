import { createFactsClient, computeFacts } from '../../scripts/facts/compute.mjs'

async function run() {
  const sb = createFactsClient()

  console.log("--- 1. End-to-end pipeline ---")
  const start = Date.now()
  let numFacts = 0
  try {
    numFacts = await computeFacts(sb)
    console.log(`Success! Computed and upserted ${numFacts} facts in ${Date.now() - start}ms.`)
  } catch(e) {
    console.error("Pipeline failed:", e)
  }

  console.log("\n--- 2. Idempotency test ---")
  const start2 = Date.now()
  try {
    const numFacts2 = await computeFacts(sb)
    console.log(`Success! Re-ran pipeline. Upserted ${numFacts2} facts (should match ${numFacts}) in ${Date.now() - start2}ms.`)
  } catch(e) {
    console.error("Idempotency failed:", e)
  }

  console.log("\n--- 3. Empty-state protection ---")
  console.log("Verifying compute.mjs exits on empty data.")
  const { execSync } = await import('node:child_process')
  try {
    execSync('node scripts/facts/compute.mjs EMPTY_TEST_MODE', { stdio: 'pipe' })
    console.error("Failed! Did not abort on empty state.")
  } catch (e) {
    if (e.stderr && e.stderr.toString().includes('No facts computed for this batch. Aborting')) {
      console.log("Success! Pipeline correctly aborted on empty data.")
    } else {
      console.error("Failed with unexpected error:", e.stderr?.toString() || e.message)
    }
  }
}
run().catch(console.error)
