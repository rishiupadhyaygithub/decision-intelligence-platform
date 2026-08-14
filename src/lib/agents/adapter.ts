import { GoogleGenerativeAI } from '@google/generative-ai'

// Model-agnostic seam. Swap this one file to change providers without touching
// any agent. Keeps the "company veteran" (facts + memory) independent of the model.
const apiKey = process.env.GEMINI_API_KEY
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

export type Tier = 'fast' | 'smart'
const MODELS: Record<Tier, string> = {
  fast: 'gemini-3.5-flash-lite',
  smart: 'gemini-3.5-flash',
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
  } catch (e) {
    console.error("Gemini failed:", e)
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
