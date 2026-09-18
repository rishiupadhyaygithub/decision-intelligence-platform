import { retrieveFacts } from '../../src/lib/agents/retriever.ts'

async function testRetrieval() {
  const result1 = await retrieveFacts('North sales')
  console.log("Retrieval for 'North sales':", result1.length, "facts")
  
  const result2 = await retrieveFacts('dummy_search_that_returns_nothing')
  console.log("Empty retrieval:", result2.length, "facts")
}

testRetrieval()
