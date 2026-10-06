// Diagnose why /api/analyze-decision always lands on deterministic-fallback.
// Prints finishReason + token usage for a small vs large maxOutputTokens. Never prints the key.
// Run from the repo root: node --env-file=.env.local scripts/dev/gemini-probe.mjs
import { GoogleGenerativeAI } from '@google/generative-ai'

if (!process.env.GEMINI_API_KEY) {
  console.log('GEMINI_API_KEY is not set — every llm() call returns null, so every analysis falls back.')
  process.exit(0)
}
const g = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const prompt =
  'Return JSON {"summary":string,"claims":[{"text":string,"type":"factual","structured_evidence":' +
  '[{"fact_id":string,"metric":string,"value":number,"dims":object}]}],"risks":[],"alternatives":[],' +
  '"recommendation":string}. Facts: [f1] inventory_cover_ratio sku=SC-001 region=West value=0.62; ' +
  '[f2] sku_velocity_delta sku=SC-001 region=West value=-18.4. Decision: should we expedite restock ' +
  'of SC-001 in West? Cite fact ids in brackets.'

for (const maxOutputTokens of [1000, 8192]) {
  const m = g.getGenerativeModel({
    model: 'gemini-3.5-flash',
    generationConfig: { maxOutputTokens, responseMimeType: 'application/json' },
  })
  try {
    const r = await m.generateContent(prompt, { timeout: 60_000 })
    let text = ''
    try { text = r.response.text() } catch (e) { text = `TEXT_THREW: ${e.message}` }
    let jsonParses = false
    try { JSON.parse(text); jsonParses = true } catch {}
    console.log(JSON.stringify({
      maxOutputTokens,
      finishReason: r.response.candidates?.[0]?.finishReason,
      textLen: text.length,
      jsonParses,
      usage: r.response.usageMetadata,
    }))
  } catch (e) {
    console.log(JSON.stringify({ maxOutputTokens, error: String(e.message).slice(0, 300) }))
  }
}
