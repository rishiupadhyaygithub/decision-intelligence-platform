// scripts/facts/compute.mjs
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { flagOutliers } from './quality.mjs'
import { scoreHealth, healthSummary } from './health.mjs'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

export function createFactsClient() {
  return createClient(url, key, { auth: { persistSession: false } })
}

const factId = (metric, dims) =>
  'f_' + createHash('sha1').update(metric + JSON.stringify(dims)).digest('hex').slice(0, 16)

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const std = (a) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
const conf = (n) => Math.min(0.95, Math.round((1 - 1 / Math.sqrt(Math.max(n, 1))) * 100) / 100)

async function readView(sb, name, orderByCols = []) {
  const allData = []
  let offset = 0
  const limit = 1000
  while (true) {
    let query = sb.from(name).select('*')
    for (const col of orderByCols) {
      // Split asc/desc if provided, e.g. "month.desc"
      const [c, dir] = col.split('.')
      query = query.order(c, { ascending: dir !== 'desc' })
    }
    // Fallback order by all columns if none provided, to ensure some determinism
    // but caller should really provide unique keys.
    
    const { data, error } = await query.range(offset, offset + limit - 1)
    if (error) throw new Error(`${name}: ${error.message}`)
    if (!data || data.length === 0) break
    allData.push(...data)
    if (data.length < limit) break
    offset += limit
  }
  return allData
}

export async function computeFacts(sb) {
  const facts = []
  const now = new Date().toISOString()
  // Every metric maps to a formula_id and a source view for lineage. Kept
  // inline (not the app-side registry) so the pipeline stays standalone.
  const FORMULA = {
    revenue_trend_recent: { formula_id: 'revenue_trend_recent', source: 'v_revenue_by_region_daily' },
    revenue_anomaly_z:    { formula_id: 'revenue_anomaly_z',    source: 'v_revenue_by_region_daily' },
    margin_pct:           { formula_id: 'margin_pct',           source: 'v_margin' },
    sku_velocity_delta:   { formula_id: 'sku_velocity_delta',   source: 'v_sku_velocity' },
    inventory_cover_ratio:{ formula_id: 'inventory_cover_ratio',source: 'v_inventory_risk' },
    competitor_pressure_pct:{ formula_id: 'competitor_pressure_pct', source: 'v_competitor_pressure' },
  }
  const push = (metric, dims, value, opts = {}) => {
    const spec = FORMULA[metric] || {}
    facts.push({
      id: factId(metric, dims),
      metric,
      dims,
      value: value == null ? null : Number(value.toFixed(2)),
      value_text: opts.valueText ?? null,
      time_window: opts.window ?? null,
      method: opts.method ?? 'sql',
      sample_n: opts.n ?? null,
      confidence: opts.confidence ?? (opts.n ? conf(opts.n) : null),
      computed_at: now,
      formula_id: opts.formulaId ?? spec.formula_id ?? metric,
      source_rows: opts.sourceRows ?? (spec.source ? [{ table: spec.source, pk: JSON.stringify(dims) }] : []),
      unstable: false,
    })
  }

  // 1. Revenue
  for (const r of await readView(sb, 'v_fact_revenue_trend', ['region'])) {
    push('revenue_trend_recent', { region: r.region }, r.delta_pct, {
      window: 'recent_vs_base', method: 'sql:pct', n: r.total_rows,
    })
    push('revenue_anomaly_z', { region: r.region }, r.z_score, { 
      method: 'sql:zscore', n: r.total_rows 
    })
  }

  // 2. Margin
  for (const m of await readView(sb, 'v_margin', ['sku_id'])) {
    push('margin_pct', { sku: m.sku_id }, Number(m.margin_pct), {
      method: 'sql', n: 1, confidence: 0.99,
    })
  }

  // 3. SKU Velocity
  for (const v of await readView(sb, 'v_fact_sku_velocity', ['sku_id', 'region'])) {
    push('sku_velocity_delta', { sku: v.sku_id, region: v.region }, v.delta_pct, {
      window: 'week', method: 'sql:pct', n: v.total_rows,
    })
  }

  // 4. Inventory
  for (const r of await readView(sb, 'v_fact_inventory', ['sku_id', 'region'])) {
    push('inventory_cover_ratio', { sku: r.sku_id, region: r.region }, Number(r.cover_ratio), {
      window: 'latest', method: 'sql', n: 1, valueText: r.below_reorder ? 'below_reorder' : 'ok',
    })
  }

  // 5. Competitor
  for (const c of await readView(sb, 'v_fact_competitor', ['category'])) {
    push('competitor_pressure_pct', { category: c.category }, Number(c.pressure_pct), {
      method: 'sql', n: c.total_signals,
    })
  }

  // --- Python ML layer -----------------------------------------------------
  // Fail-OPEN by design: the SQL facts above are the trustworthy core of the
  // system. A missing python3, an unset dep, or one bad model must degrade the
  // batch to SQL-only — not destroy it. Callers see which models were skipped in
  // the [ml] log line, and the absent facts simply stop grounding answers.
  // execFile (not exec) => no shell, args passed as an array.
  const ML_SCRIPTS = [
    ['forecast', 'ml/forecast.py'],
    ['churn', 'ml/churn.py'],
    ['sentiment', 'ml/sentiment.py'],
  ]
  const ML_TIMEOUT_MS = 120_000
  const ML_MAXBUFFER = 32 * 1024 * 1024 // 32MB — default 1MB truncates larger fact batches

  const pyFacts = []
  const mlSkipped = []
  {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    // Child inherits the parent env plus the resolved Supabase creds.
    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
    }

    for (const [name, script] of ML_SCRIPTS) {
      try {
        const { stdout } = await execFileAsync('python3', [script], {
          env,
          timeout: ML_TIMEOUT_MS,
          maxBuffer: ML_MAXBUFFER,
        })
        const parsed = JSON.parse(stdout || '[]')
        if (!Array.isArray(parsed)) throw new Error('expected a JSON array')
        pyFacts.push(...parsed)
      } catch (e) {
        // Never rethrow: a broken model degrades this batch, it does not fail it.
        mlSkipped.push(name)
        console.error(`[ml] ${name} skipped: ${e.message}`)
      }
    }
    console.log(
      `[ml] ${pyFacts.length} facts from ${ML_SCRIPTS.length - mlSkipped.length}/${ML_SCRIPTS.length} models` +
        (mlSkipped.length ? ` (skipped: ${mlSkipped.join(', ')})` : '')
    )
  }

  // Generate deterministic fact IDs for Python ML facts to prevent conflicts
  // and match the DB schema shape
  for (const f of pyFacts) {
    f.id = factId(f.metric, f.dims)
    f.computed_at = now
    f.formula_id = f.formula_id ?? f.metric
    f.source_rows = f.source_rows ?? []
    f.unstable = f.unstable ?? false
    facts.push(f)
  }

  if (!facts.length) {
    // throw, never process.exit — run.mjs wraps this in stage() and must be allowed
    // to write the failure to job_runs. process.exit here strands the row at
    // status='running' forever and the System Health panel silently lies.
    throw new Error(
      'No facts computed for this batch — aborting publication to preserve last known-good state.'
    )
  }

  // W1 — quality + health pass before persistence.
  const qual = flagOutliers(facts)
  scoreHealth(facts)
  const summary = healthSummary(facts)
  console.log(
    `[quality] flagged ${qual.flagged}/${qual.totalScanned} unstable; ` +
      `[health] mean=${summary.mean} p10=${summary.p10} low=${summary.low_quality}`
  )

  // --- stale pruning, metric-scoped ---------------------------------------
  // The concern that motivated disabling this was real: if a source view returns
  // empty for one run, a naive "delete everything not in the new set" wipes good
  // facts. But leaving `stale` permanently empty is not the fix — data_health is a
  // STORED column, read back via .gte('data_health', 0.5) in the retriever and
  // never recomputed. Orphaned facts therefore keep their frozen score, stay above
  // the gate, and ground answers forever. The table only grows.
  //
  // Correct rule: only prune inside metrics this batch actually produced. A metric
  // that yielded nothing (empty source, skipped ML model) is left fully intact;
  // a metric that yielded facts has its superseded rows removed.
  const newIds = new Set(facts.map((f) => f.id))
  const producedMetrics = new Set(facts.map((f) => f.metric))

  const { data: existing, error: listErr } = await sb.from('facts').select('id, metric')
  if (listErr) throw new Error(`facts list: ${listErr.message}`)

  const stale = (existing ?? [])
    .filter((row) => producedMetrics.has(row.metric) && !newIds.has(row.id))
    .map((row) => row.id)

  console.log(
    `[prune] ${stale.length} superseded facts across ${producedMetrics.size} recomputed metrics ` +
      `(${(existing ?? []).length} existing, ${facts.length} incoming)`
  )

  const { error } = await sb.rpc('publish_facts', {
    new_facts: facts,
    stale_ids: stale
  })
  if (error) throw new Error(`facts publish_facts rpc: ${error.message}`)

  return facts.length
}

import { fileURLToPath } from 'node:url'

async function main() {
  const n = await computeFacts(createFactsClient())
  console.log(`Upserted ${n} facts.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
}
