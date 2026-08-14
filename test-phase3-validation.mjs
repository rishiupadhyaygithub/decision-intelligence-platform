import { validate } from './src/lib/agents/validator.ts'

const mockFacts = [
  { id: 'f_1', metric: 'sales', value: 100, dims: { region: 'North' } },
  { id: 'f_2', metric: 'churn', value: 5, dims: { region: 'South' } }
]

function runTest(name, reasonOut, expectedViolations) {
  const result = validate(reasonOut, mockFacts)
  if (result.ok === (expectedViolations === 0)) {
    console.log(`✅ ${name} passed`)
  } else {
    console.error(`❌ ${name} failed`)
    console.error('Expected violations:', expectedViolations, 'Got:', result.violations)
  }
}

// 1. Evidence references nonexistent fact -> fail
runTest('Evidence references nonexistent fact', {
  claims: [{ text: 'Sales [fake_id]', type: 'factual', structured_evidence: [{ fact_id: 'fake_id', metric: 'sales' }] }]
}, 1)

// 2. Wrong metric -> fail
runTest('Wrong metric', {
  claims: [{ text: 'Revenue [f_1]', type: 'factual', structured_evidence: [{ fact_id: 'f_1', metric: 'revenue' }] }]
}, 1)

// 3. Wrong value -> fail
runTest('Wrong value', {
  claims: [{ text: 'Sales 50 [f_1]', type: 'factual', structured_evidence: [{ fact_id: 'f_1', metric: 'sales', value: 50 }] }]
}, 1)

// 4. Wrong dimensions -> fail
runTest('Wrong dimensions', {
  claims: [{ text: 'Sales in West [f_1]', type: 'factual', structured_evidence: [{ fact_id: 'f_1', metric: 'sales', dims: { region: 'West' } }] }]
}, 1)

// 5. Prose cites ID absent from evidence -> fail
runTest('Prose cites ID absent from evidence', {
  claims: [{ text: 'Sales 100 [f_1]', type: 'factual', structured_evidence: [] }] // No evidence!
}, 2) // "Factual claims require structured evidence" + "Prose citation missing from structured_evidence"

// 6. Evidence exists but isn't actually associated with the claim (uncited in prose) -> fail
runTest('Evidence uncited in prose', {
  claims: [{ text: 'Sales 100', type: 'factual', structured_evidence: [{ fact_id: 'f_1', metric: 'sales' }] }]
}, 1) // "structured_evidence item not cited in prose text"

// 7. Valid factual claim -> pass
runTest('Valid factual claim', {
  claims: [{ text: 'Sales 100 [f_1]', type: 'factual', structured_evidence: [{ fact_id: 'f_1', metric: 'sales', value: 100, dims: { region: 'North' } }] }]
}, 0)

// 8. Valid inference explicitly marked inference -> pass
runTest('Valid inference', {
  claims: [{ text: 'We should restock [f_1]', type: 'inference', structured_evidence: [{ fact_id: 'f_1', metric: 'sales' }] }]
}, 0)

console.log("Validator completeness tests complete.")
