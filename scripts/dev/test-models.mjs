import { GoogleGenerativeAI } from '@google/generative-ai'

async function test() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash']
  
  for (const m of models) {
    try {
      const model = genAI.getGenerativeModel({ model: m })
      const r = await model.generateContent("hello")
      console.log(`${m}: SUCCESS - ${r.response.text()}`)
    } catch (e) {
      console.log(`${m}: FAILED - ${e.message}`)
    }
  }
}
test()
