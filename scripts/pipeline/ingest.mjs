// scripts/pipeline/ingest.mjs
// Market-data ingestion — pluggable adapter. Default: evolving-synthetic stream
// (free, no keys, labeled synthetic like the rest of the demo data). It appends
// fresh dated rows so trends actually MOVE between pipeline runs, which is what
// makes the system feel live. Swap `generate` for a real feed adapter later
// (RSS/news/commodity API) behind the same signature.

const SIGNAL_TEMPLATES = [
  { category: 'pricing', impact: 'high', urgent: true, body: 'Rival ran a flash sale on competing SKUs, pressure on margin.' },
  { category: 'demand', impact: 'medium', urgent: false, body: 'Festive demand spike observed in northern regions.' },
  { category: 'supply', impact: 'high', urgent: true, body: 'Raw spice input squeeze reported; stockout risk rising.' },
  { category: 'sentiment', impact: 'low', urgent: false, body: 'Positive first-mover buzz on new masala line, tailwind.' },
]

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const jitter = (base, pct) => Math.max(0, Math.round(base * (1 + (Math.random() * 2 - 1) * pct)))

// Append one new day of sales (per sku/region, based on recent mean) + one signal.
async function generate(sb) {
  // referential integrity: only use sku/region pairs that already exist
  const { data: recent, error } = await sb
    .from('sales')
    .select('sku_id,region,channel,sale_date,units,revenue')
    .order('sale_date', { ascending: false })
    .limit(400)
  if (error) throw new Error(`ingest read sales: ${error.message}`)
  if (!recent?.length) throw new Error('ingest: no sales to extend')

  const latest = recent[0].sale_date
  const next = new Date(latest)
  next.setUTCDate(next.getUTCDate() + 1)
  const nextDate = next.toISOString().slice(0, 10)

  // mean units/revenue per sku|region|channel from recent history
  const agg = {}
  for (const r of recent) {
    const k = `${r.sku_id}\0${r.region}\0${r.channel}`
    ;(agg[k] ??= { u: [], rev: [] }).u.push(Number(r.units))
    agg[k].rev.push(Number(r.revenue))
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length

  const rows = Object.entries(agg).slice(0, 24).map(([k, v]) => {
    const [sku_id, region, channel] = k.split('\0')
    const units = jitter(mean(v.u), 0.18)
    const unitRev = mean(v.rev) / (mean(v.u) || 1)
    return { sku_id, region, channel, sale_date: nextDate, units, revenue: Math.round(units * unitRev * 100) / 100 }
  })

  const { error: insErr } = await sb.from('sales').upsert(rows, { onConflict: 'sku_id,region,channel,sale_date', ignoreDuplicates: false })
  if (insErr) throw new Error(`ingest upsert sales: ${insErr.message}`)

  const t = pick(SIGNAL_TEMPLATES)
  const { error: sigErr } = await sb.from('competitor_signal').insert({
    source: 'synthetic-stream',
    category: t.category,
    body: t.body,
    impact: t.impact,
    urgent: t.urgent,
    detected_at: new Date().toISOString(),
  })
  if (sigErr) throw new Error(`ingest insert signal: ${sigErr.message}`)

  return rows.length + 1
}

// Public entrypoint. Returns number of rows ingested.
// The synthetic stream only ever runs on the demo dataset. Once a team imports its own
// data (app_settings.data_mode = 'custom', migration 0018) appending fake sales would
// corrupt it, so ingest becomes a no-op. A missing table means a pre-0018 install,
// which can only hold demo data.
export async function ingestMarketData(sb) {
  const { data, error } = await sb.from('app_settings').select('value').eq('key', 'data_mode').maybeSingle()
  if (error && !/app_settings|does not exist|schema cache/i.test(error.message)) {
    throw new Error(`ingest read data_mode: ${error.message}`)
  }
  if (data?.value === 'custom') {
    console.log('[ingest] custom dataset: synthetic stream skipped')
    return 0
  }
  return generate(sb)
}
