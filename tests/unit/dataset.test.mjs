// Bring-your-own-data: CSV parsing and import validation.
// Run: node --test 'tests/unit/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, toCsv } from '../../src/lib/data/csv.ts'
import { validateDataset } from '../../src/lib/data/dataset.ts'

const SKUS = 'sku_id,name,category,mrp,unit_cost,launched_on\nA1,Alpha,snacks,10,6,2025-01-01\nB2,"Beta, Large",snacks,20,12,\n'
const weeks = (n) =>
  Array.from({ length: n }, (_, i) => `A1,West,d2c,${new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10)},5,50`).join('\n')
const SALES = `sku_id,region,channel,sale_date,units,revenue\n${weeks(10)}\n`

test('csv: quotes, escaped quotes, embedded commas/newlines, CRLF, BOM', () => {
  const p = parseCsv('\uFEFFa,b\r\n"x, ""y""","line1\nline2"\r\n')
  assert.deepEqual(p.headers, ['a', 'b'])
  assert.deepEqual(p.rows, [{ a: 'x, "y"', b: 'line1\nline2' }])
})

test('csv: blank lines ignored, headers lower-cased and trimmed', () => {
  assert.deepEqual(parseCsv(' SKU_ID , Name \n\nA1,Alpha\n\n').rows, [{ sku_id: 'A1', name: 'Alpha' }])
})

test('csv: toCsv round-trips through parseCsv', () => {
  const rows = [{ a: 'x, "y"', b: 'multi\nline' }, { a: '', b: 3 }]
  assert.deepEqual(parseCsv(toCsv(['a', 'b'], rows)).rows, [{ a: 'x, "y"', b: 'multi\nline' }, { a: '', b: '3' }])
})

test('valid dataset passes with coerced types', () => {
  const r = validateDataset({ skus: SKUS, sales: SALES })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.counts.sales, 10)
  assert.equal(r.rows.skus[1].name, 'Beta, Large')
  assert.equal(r.rows.skus[1].launched_on, undefined)
  assert.equal(typeof r.rows.sales[0].units, 'number')
})

test('skus and sales are required', () => {
  const r = validateDataset({ skus: SKUS })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.message.includes('sales.csv is required')))
})

test('missing column is reported with the expected header', () => {
  const r = validateDataset({ skus: 'sku_id,name\nA1,x\n', sales: SALES })
  assert.ok(r.errors.some((e) => e.dataset === 'skus' && e.message.includes('expected header')))
})

test('row-level errors carry dataset, row and column', () => {
  const bad = 'sku_id,region,channel,sale_date,units,revenue\nA1,West,d2c,2026-13-40,5,50\nA1,West,d2c,2026-01-05,-1,abc\n'
  const r = validateDataset({ skus: SKUS, sales: bad })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.row === 1 && e.column === 'sale_date'))
  assert.ok(r.errors.some((e) => e.row === 2 && e.column === 'units'))
  assert.ok(r.errors.some((e) => e.row === 2 && e.column === 'revenue'))
})

test('sales for an unknown sku is rejected before the database sees it', () => {
  const r = validateDataset({ skus: SKUS, sales: 'sku_id,region,channel,sale_date,units,revenue\nZZ,West,d2c,2026-01-05,1,1\n' })
  assert.ok(r.errors.some((e) => e.message.includes('unknown sku_id "ZZ"')))
})

test('duplicate sku ids are rejected', () => {
  const r = validateDataset({ skus: SKUS + 'A1,Again,snacks,1,1,\n', sales: SALES })
  assert.ok(r.errors.some((e) => e.message.includes('duplicate sku_id')))
})

test('duplicate sales keys are rejected with the row they repeat', () => {
  const dup = 'sku_id,region,channel,sale_date,units,revenue\nA1,West,d2c,2026-01-05,1,1\nA1,West,d2c,2026-01-05,2,2\n'
  const r = validateDataset({ skus: SKUS, sales: dup })
  assert.ok(r.errors.some((e) => e.row === 2 && e.message.includes('duplicate of row 1')))
})

test('short history and missing optional files produce warnings, not errors', () => {
  const r = validateDataset({ skus: SKUS, sales: `sku_id,region,channel,sale_date,units,revenue\n${weeks(3)}\n` })
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some((w) => w.includes('8 weeks')))
  assert.ok(r.warnings.some((w) => w.includes('inventory')))
})

test('signals: impact and urgent are constrained', () => {
  const sig = 'source,category,body,impact,detected_at,urgent\nnews,pricing,rival cut,severe,,maybe\nnews,pricing,ok,high,2026-01-05T09:00:00Z,true\n'
  const r = validateDataset({ skus: SKUS, sales: SALES, signals: sig })
  assert.ok(r.errors.some((e) => e.dataset === 'signals' && e.column === 'impact'))
  assert.ok(r.errors.some((e) => e.dataset === 'signals' && e.column === 'urgent'))
  assert.equal(r.rows.signals[0].urgent, true)
})
