import { GoogleGenerativeAI } from '@google/generative-ai'

// Model-agnostic seam. Swap this one file to change providers without touching
// any agent. Keeps the "company veteran" (facts + memory) independent of the model.
const apiKey = process.env.GEMINI_API_KEY
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

export type Tier = 'fast' | 'smart'
const MODELS: Record<Tier, string> = {
  fast: 'gemini-2.0-flash-lite', // cheap: retrieval, skeptic
  smart: 'gemini-2.0-flash',     // final reasoning
}

export interface LlmOpts {
  system?: string
  tier?: Tier
  json?: boolean
  maxTokens?: number
}

export async function llm(prompt: string, opts: LlmOpts = {}): Promise<string | null> {
  if (!genAI) return null
  const model = genAI.getGenerativeModel({
    model: MODELS[opts.tier ?? 'fast'],
    ...(opts.system ? { systemInstruction: opts.system } : {}),
    generationConfig: {
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  })
  try {
    const r = await model.generateContent(prompt)
    return r.response.text()
  } catch {
    return null
  }
}

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim()) as T
  } catch {
    return null
  }
}
