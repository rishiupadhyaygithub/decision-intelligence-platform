// Validation for a bring-your-own-data import. Four CSVs map 1:1 onto the raw tables
// the pipeline reads (0001_init.sql): skus + sales are required, inventory and
// signals are optional. Every row is checked here so the database never sees a bad
// row; import_dataset (0018) then swaps everything in one transaction.
//
// No path aliases in this file: it is unit-tested directly with node --test.

import { z } from 'zod'
import { parseCsv } from './csv.ts'

export const DATASETS = ['skus', 'sales', 'inventory', 'signals'] as const
export type DatasetName = (typeof DATASETS)[number]

export const REQUIRED: Record<DatasetName, boolean> = { skus: true, sales: true, inventory: false, signals: false }

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'not a real date')
const num = z.coerce.number().refine(Number.isFinite, 'not a number').refine((n) => n >= 0, 'must be >= 0')
const int = z.coerce.number().int('must be a whole number').min(0, 'must be >= 0')
const text = (max: number) => z.string().min(1, 'required').max(max, `max ${max} chars`)
const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional())

export const SCHEMAS = {
  skus: z.object({
    sku_id: text(64),
    name: text(200),
    category: text(100),
    mrp: num,
    unit_cost: num,
    launched_on: optional(date),
  }),
  sales: z.object({
    sku_id: text(64),
    region: text(100),
    channel: text(50),
    sale_date: date,
    units: int,
    revenue: num,
  }),
  inventory: z.object({
    sku_id: text(64),
    region: text(100),
    snapshot_date: date,
    on_hand: int,
    reorder_point: int,
  }),
  signals: z.object({
    source: text(200),
    category: text(100),
    body: text(2000),
    impact: z.enum(['high', 'medium', 'low'], 'use high, medium or low'),
    detected_at: optional(z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'not a real date/time')),
    urgent: optional(z.enum(['true', 'false'], 'use true or false').transform((v) => v === 'true')),
  }),
} as const

export const COLUMNS: Record<DatasetName, string[]> = {
  skus: ['sku_id', 'name', 'category', 'mrp', 'unit_cost', 'launched_on'],
  sales: ['sku_id', 'region', 'channel', 'sale_date', 'units', 'revenue'],
  inventory: ['sku_id', 'region', 'snapshot_date', 'on_hand', 'reorder_point'],
  signals: ['source', 'category', 'body', 'impact', 'detected_at', 'urgent'],
}

export const LIMITS = { maxBytesPerFile: 10 * 1024 * 1024, maxRowsTotal: 250_000, maxErrors: 50 }

export interface RowError {
  dataset: DatasetName
  row: number // 1-based data row (header excluded), as shown in a spreadsheet: +1 for the header
  column: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  counts: Record<DatasetName, number>
  errors: RowError[]
  errorCount: number
  warnings: string[]
  rows: { [K in DatasetName]: z.infer<(typeof SCHEMAS)[K]>[] }
}

export function validateDataset(files: Partial<Record<DatasetName, string>>): ValidationResult {
  const errors: RowError[] = []
  let errorCount = 0
  const warnings: string[] = []
  const rows = { skus: [], sales: [], inventory: [], signals: [] } as unknown as ValidationResult['rows']
  const counts = { skus: 0, sales: 0, inventory: 0, signals: 0 }
  const push = (e: RowError) => {
    errorCount++
    if (errors.length < LIMITS.maxErrors) errors.push(e)
  }

  for (const name of DATASETS) {
    const raw = files[name]
    if (!raw || !raw.trim()) {
      if (REQUIRED[name]) push({ dataset: name, row: 0, column: '-', message: `${name}.csv is required` })
      continue
    }
    const { headers, rows: records } = parseCsv(raw)
    const required = Object.entries(SCHEMAS[name].shape)
      .filter(([, s]) => !(s as z.ZodTypeAny).safeParse(undefined).success)
      .map(([k]) => k)
    const missing = required.filter((c) => !headers.includes(c))
    if (missing.length) {
      push({ dataset: name, row: 0, column: missing.join(', '), message: `missing column(s); expected header: ${COLUMNS[name].join(',')}` })
      continue
    }
    counts[name] = records.length
    records.forEach((rec, i) => {
      const parsed = SCHEMAS[name].safeParse(rec)
      if (parsed.success) (rows[name] as unknown[]).push(parsed.data)
      else for (const issue of parsed.error.issues) push({ dataset: name, row: i + 1, column: String(issue.path[0] ?? '-'), message: issue.message })
    })
  }

  const total = DATASETS.reduce((s, n) => s + counts[n], 0)
  if (total > LIMITS.maxRowsTotal) push({ dataset: 'sales', row: 0, column: '-', message: `${total} rows exceeds the ${LIMITS.maxRowsTotal} row limit` })

  // Referential checks: the database enforces these too, but a row-level message here
  // beats one foreign-key error for the whole import.
  const skuIds = new Set(rows.skus.map((r) => r.sku_id))
  const dupes = rows.skus.length - skuIds.size
  if (dupes) push({ dataset: 'skus', row: 0, column: 'sku_id', message: `${dupes} duplicate sku_id value(s)` })
  for (const name of ['sales', 'inventory'] as const) {
    rows[name].forEach((r, i) => {
      if (!skuIds.has(r.sku_id)) push({ dataset: name, row: i + 1, column: 'sku_id', message: `unknown sku_id "${r.sku_id}" (not in skus.csv)` })
    })
  }

  // sales has UNIQUE (sku_id, region, channel, sale_date) (0009); a duplicate would
  // abort the whole import with one database error, so name the row instead.
  const seen = new Map<string, number>()
  rows.sales.forEach((r, i) => {
    const k = `${r.sku_id}|${r.region}|${r.channel}|${r.sale_date}`
    const first = seen.get(k)
    if (first !== undefined) push({ dataset: 'sales', row: i + 1, column: 'sale_date', message: `duplicate of row ${first} (same sku_id, region, channel, sale_date)` })
    else seen.set(k, i + 1)
  })

  // The pipeline needs history: velocity uses >= 4 weeks, forecasts >= 6 weeks.
  if (rows.sales.length) {
    const days = rows.sales.map((r) => Date.parse(r.sale_date))
    const spanWeeks = (Math.max(...days) - Math.min(...days)) / (7 * 864e5)
    if (spanWeeks < 8) warnings.push(`sales cover ${spanWeeks.toFixed(1)} weeks; trends and forecasts need at least 8 weeks of history to be reliable`)
  }
  if (!rows.inventory.length) warnings.push('no inventory.csv: inventory cover and stockout metrics will be empty')
  if (!rows.signals.length) warnings.push('no signals.csv: competitor pressure metrics will be empty')

  return { ok: errorCount === 0, counts, errors, errorCount, warnings, rows }
}
