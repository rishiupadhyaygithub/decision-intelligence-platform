import { POST } from './src/app/api/analyze-decision/route.ts'

async function testEndpoint() {
  const req = new Request('http://localhost:3000/api/analyze-decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Reduce inventory in North',
      proposal: 'We should reduce inventory because velocity is low.',
      context: 'Q3 planning'
    })
  })

  // We have to mock supabase auth to avoid 401
  const mockAuth = {
    auth: { getUser: async () => ({ data: { user: { id: 'test' } } }) }
  }
  
  // Since we can't easily mock the server supabase client within the Next.js context from a simple script, 
  // maybe we don't test the route this way. We already tested retriever and validator.
}
