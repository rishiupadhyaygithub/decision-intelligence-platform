// Check which Gemini models in the adapter's fallback chain your key can use right now.
// Prints status + finishReason + token usage per model. Never prints the key.
// Run from the repo root: node --env-file=.env.local scripts/dev/gemini-probe.mjs
import { GoogleGenerativeAI } from '@google/generative-ai'

if (!process.env.GEMINI_API_KEY) {
  console.log('GEMINI_API_KEY is not set — every llm() call returns null, so every analysis falls back.')
  process.exit(0)
}
// Keep in sync with MODELS in src/lib/agents/adapter.ts.
const MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']

const g = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const prompt =
  'Return JSON {"summary":string,"claims":[{"text":string,"type":"factual","structured_evidence":' +
  '[{"fact_id":string,"metric":string,"value":number,"dims":object}]}],"risks":[],"alternatives":[],' +
  '"recommendation":string}. Facts: [f1] inventory_cover_ratio sku=SC-001 region=West value=0.62; ' +
  '[f2] sku_velocity_delta sku=SC-001 region=West value=-18.4. Decision: should we expedite restock ' +
  'of SC-001 in West? Cite fact ids in brackets.'

for (const name of MODELS) {
  const m = g.getGenerativeModel({
    model: name,
    generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
  })
  const t0 = Date.now()
  try {
    const r = await m.generateContent(prompt, { timeout: 60_000 })
    let text = ''
    try { text = r.response.text() } catch (e) { text = `TEXT_THREW: ${e.message}` }
    let jsonParses = false
    try { JSON.parse(text); jsonParses = true } catch {}
    console.log(JSON.stringify({
      model: name,
      ok: jsonParses,
      secs: (Date.now() - t0) / 1000,
      finishReason: r.response.candidates?.[0]?.finishReason,
      thoughts: r.response.usageMetadata?.thoughtsTokenCount,
    }))
  } catch (e) {
    const msg = String(e.message)
    const status = msg.match(/\[(\d{3}) [^\]]*\]/)?.[1] ?? 'error'
    console.log(JSON.stringify({ model: name, ok: false, status, error: msg.replace(/^.*\] /, '').slice(0, 140) }))
  }
}
