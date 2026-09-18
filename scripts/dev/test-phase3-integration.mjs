import { reason, fallbackReason } from '../../src/lib/agents/reasoner.ts'
import { retrieveFacts } from '../../src/lib/agents/retriever.ts'
import { validate } from '../../src/lib/agents/validator.ts'
import { shapeTradeoffs } from '../../src/lib/prescribe/tradeoffs.ts'

async function testIntegration() {
  const proposal = "The inventory in North is too high, let's cut SKUs by 50% immediately."
  console.log("Retrieving facts...")
  const facts = await retrieveFacts(proposal)
  console.log(`Retrieved ${facts.length} facts.`)

  console.log("Calling LLM reasoner...")
  const { llm } = await import('../../src/lib/agents/adapter.ts')
  const raw = await llm("test", { tier: 'smart', json: true, system: 'Output {"test": 1}', maxTokens: 100 })
  console.log("Raw output:", raw)
  const r = await reason(proposal, facts)
  
  console.log("LLM Output:", JSON.stringify(r, null, 2))
  
  console.log("Validating...")
  const check = validate(r, facts)
  if (check.ok) {
    console.log("✅ Validation passed!")
  } else {
    console.error("❌ Validation failed:", check.violations)
  }

  console.log("Testing deterministic fallback...")
  const fb = fallbackReason(facts)
  const fbCheck = validate(fb, facts)
  if (fbCheck.ok) {
    console.log("✅ Fallback validation passed!")
  } else {
    console.error("❌ Fallback validation failed:", fbCheck.violations)
  }

  console.log("Testing tradeoff shaping...")
  const options = shapeTradeoffs({
    recommendation: r.recommendation,
    alternatives: r.alternatives,
    summary: r.summary
  }, facts, null)
  console.log("Tradeoff Options:", JSON.stringify(options, null, 2))
}

testIntegration()
