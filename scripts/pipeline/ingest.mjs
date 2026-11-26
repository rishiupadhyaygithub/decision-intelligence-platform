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
const gauss = () => {
  // Box-Muller: a standard normal draw for week-to-week noise.
  const u = 1 - Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}
const DAY = 864e5
const MAX_WEEKS_PER_RUN = 40

// The seed holds ONE row per sku/region/channel per WEEK (Mondays). New rows must
// keep that grain: the old daily stream wrote a week's worth of units every day,
// which multiplied weekly totals ~7x and turned every trend and forecast into noise.
// Appends each missing week up to the current one (so the demo stays current),
// mean-reverting to the series' recent level with mild noise.
async function generate(sb) {
  const { data: recent, error } = await sb
    .from('sales')
    .select('sku_id,region,channel,sale_date,units,revenue')
    .order('sale_date', { ascending: false })
    .limit(600)
  if (error) throw new Error(`ingest read sales: ${error.message}`)
  if (!recent?.length) throw new Error('ingest: no sales to extend')

  const latest = Date.parse(recent[0].sale_date)
  const series = {}
  for (const r of recent) {
    // only the last 8 weeks inform the level
    if (latest - Date.parse(r.sale_date) > 7 * 8 * DAY) continue
    const k = `${r.sku_id}\0${r.region}\0${r.channel}`
    const s = (series[k] ??= { units: [], rev: [], last: null })
    s.units.push(Number(r.units))
    s.rev.push(Number(r.revenue))
    if (s.last === null) s.last = Number(r.units)
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length

  // Next Monday after the latest row, up to and including the current week's Monday.
  const now = new Date()
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
  const rows = []
  for (let t = latest + 7 * DAY, n = 0; t <= thisMonday && n < MAX_WEEKS_PER_RUN; t += 7 * DAY, n++) {
    const date = new Date(t).toISOString().slice(0, 10)
    for (const [k, s] of Object.entries(series)) {
      const [sku_id, region, channel] = k.split('\0')
      const level = mean(s.units)
      const unitRev = mean(s.rev) / (level || 1)
      const units = Math.max(0, Math.round(s.last + 0.35 * (level - s.last) + level * 0.06 * gauss()))
      s.last = units
      rows.push({ sku_id, region, channel, sale_date: date, units, revenue: Math.round(units * unitRev * 100) / 100 })
    }
  }

  if (rows.length) {
    const { error: insErr } = await sb.from('sales').upsert(rows, { onConflict: 'sku_id,region,channel,sale_date', ignoreDuplicates: true })
    if (insErr) throw new Error(`ingest upsert sales: ${insErr.message}`)
  }

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
