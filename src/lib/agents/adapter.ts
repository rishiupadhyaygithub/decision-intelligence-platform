import { GoogleGenerativeAI } from '@google/generative-ai'

// Model-agnostic seam. Swap this one file to change providers without touching
// any agent. Keeps the "company veteran" (facts + memory) independent of the model.
const apiKey = process.env.GEMINI_API_KEY
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

export type Tier = 'fast' | 'smart'

// Ordered fallback chains. Each Gemini model has its own free-tier quota and its own
// capacity, so when the first answers 429 (quota) or 503 (overloaded) the next one
// usually still works. Override with GEMINI_MODELS_SMART / GEMINI_MODELS_FAST
// (comma-separated) without a code change.
const chain = (envVar: string, fallback: string[]): string[] =>
  (process.env[envVar] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .concat(process.env[envVar] ? [] : fallback)

const MODELS: Record<Tier, string[]> = {
  smart: chain('GEMINI_MODELS_SMART', ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite']),
  fast: chain('GEMINI_MODELS_FAST', ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash']),
}

export interface LlmOpts {
  system?: string
  tier?: Tier
  json?: boolean
  maxTokens?: number
}

export interface LlmResult {
  text: string
  model: string
}

// Errors worth moving to the next model for: quota, overload, transient server
// failures, timeouts. Anything else (bad request, bad key) fails the same way on
// every model, so stop instead of burning the chain.
function isRetryable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /\b(429|500|502|503|504)\b|quota|overloaded|high demand|timed? ?out|abort|fetch failed/i.test(msg)
}

export async function llmWithModel(prompt: string, opts: LlmOpts = {}): Promise<LlmResult | null> {
  if (!genAI) return null
  for (const name of MODELS[opts.tier ?? 'fast']) {
    const model = genAI.getGenerativeModel({
      model: name,
      ...(opts.system ? { systemInstruction: opts.system } : {}),
      generationConfig: {
        ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    })
    try {
      // Bounded so a slow Gemini call degrades to the next model / deterministic
      // fallback instead of holding the request open until the platform kills it.
      const r = await model.generateContent(prompt, { timeout: 45_000 })
      // Gemini 3.x are thinking models: thinking tokens count against maxOutputTokens,
      // so a tight budget ends in MAX_TOKENS with empty or truncated JSON. Log it.
      const finish = r.response.candidates?.[0]?.finishReason
      if (finish && finish !== 'STOP') {
        console.warn(`Gemini ${name} finished early:`, finish, JSON.stringify(r.response.usageMetadata ?? {}))
      }
      return { text: r.response.text(), model: name }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`Gemini ${name} failed:`, msg.slice(0, 300))
      if (!isRetryable(e)) return null
    }
  }
  return null
}

export async function llm(prompt: string, opts: LlmOpts = {}): Promise<string | null> {
  return (await llmWithModel(prompt, opts))?.text ?? null
}

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim()) as T
  } catch {
    return null
  }
}
