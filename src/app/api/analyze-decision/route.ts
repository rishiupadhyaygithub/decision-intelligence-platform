import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextResponse } from 'next/server'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(request: Request) {
  try {
    const { title, proposal, context } = await request.json()

    if (!title || !proposal) {
      return NextResponse.json(
        { error: 'Title and proposal are required' },
        { status: 400 }
      )
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })

    const prompt = `
You are a senior business strategy analyst. Analyse this business decision and respond ONLY with valid JSON, no markdown, no explanation.

Decision Title: ${title}
Proposal: ${proposal}
Additional Context: ${context || 'None provided'}

Respond with exactly this JSON structure:
{
  "summary": "2-3 sentence summary of the decision",
  "top_risks": [
    { "risk": "risk description", "severity": "high|medium|low" },
    { "risk": "risk description", "severity": "high|medium|low" },
    { "risk": "risk description", "severity": "high|medium|low" }
  ],
  "alternatives": [
    { "option": "alternative option", "tradeoff": "key tradeoff" },
    { "option": "alternative option", "tradeoff": "key tradeoff" }
  ],
  "recommendation": "clear one paragraph recommendation",
  "data_health_score": 75,
  "confidence": 70
}

data_health_score is 0-100 based on how much context was provided.
confidence is 0-100 based on how clear the decision is.
`

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    const cleaned = text.replace(/```json|```/g, '').trim()
    const analysis = JSON.parse(cleaned)

    return NextResponse.json({ analysis })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    )
  }
}