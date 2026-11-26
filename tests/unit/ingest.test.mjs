// The synthetic demo stream must keep the seed's grain: one row per
// sku/region/channel per week, on Mondays, at the same scale. The old daily stream
// wrote a weekly total every day (~7x inflation), which wrecked every trend.
// Run: node --test 'tests/unit/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ingestMarketData } from '../../scripts/pipeline/ingest.mjs'

const DAY = 864e5
function fakeDb(lastMonday, mode = 'demo', lastInventory = null) {
  const sales = []
  for (let w = 0; w < 12; w++) {
    const d = new Date(Date.parse(lastMonday) - w * 7 * DAY).toISOString().slice(0, 10)
    for (const region of ['West', 'North']) sales.push({ sku_id: 'A', region, channel: 'd2c', sale_date: d, units: 1000, revenue: 50000 })
  }
  const inventory = lastInventory
    ? ['West', 'North'].map((region) => ({ sku_id: 'A', region, snapshot_date: lastInventory, on_hand: 160, reorder_point: 100 }))
    : []
  const inserted = { sales: [], signals: [], inventory: [] }
  const q = (table) => {
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      limit: async () => ({
        data: table === 'inventory' ? inventory : [...sales].sort((a, b) => b.sale_date.localeCompare(a.sale_date)),
        error: null,
      }),
      maybeSingle: async () => ({ data: { value: mode }, error: null }),
      upsert: async (rows) => (inserted.sales.push(...rows), { error: null }),
      insert: async (row) => (table === 'inventory' ? inserted.inventory.push(...row) : inserted.signals.push(row), { error: null }),
    }
    return chain
  }
  return { sb: { from: q }, inserted }
}

const mondayWeeksAgo = (n) => {
  const now = new Date()
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
  return new Date(thisMonday - n * 7 * DAY).toISOString().slice(0, 10)
}

test('appends one row per series per missing week, on Mondays, up to this week', async () => {
  const { sb, inserted } = fakeDb(mondayWeeksAgo(5))
  await ingestMarketData(sb)
  assert.equal(inserted.sales.length, 5 * 2) // 5 missing weeks x 2 series
  for (const r of inserted.sales) assert.equal(new Date(r.sale_date + 'T00:00:00Z').getUTCDay(), 1, r.sale_date)
  assert.equal(new Set(inserted.sales.map((r) => r.sale_date)).size, 5)
})

test('keeps the weekly scale (no 7x inflation)', async () => {
  const { sb, inserted } = fakeDb(mondayWeeksAgo(20))
  await ingestMarketData(sb)
  for (const r of inserted.sales) assert.ok(r.units > 600 && r.units < 1400, `units ${r.units} far from weekly level 1000`)
  for (const r of inserted.sales) assert.ok(Math.abs(r.revenue / r.units - 50) < 0.01)
})

test('already current: adds no sales rows', async () => {
  const { sb, inserted } = fakeDb(mondayWeeksAgo(0))
  await ingestMarketData(sb)
  assert.equal(inserted.sales.length, 0)
})

test('custom dataset: never touches sales or signals', async () => {
  const { sb, inserted } = fakeDb(mondayWeeksAgo(5), 'custom')
  assert.equal(await ingestMarketData(sb), 0)
  assert.equal(inserted.sales.length + inserted.signals.length, 0)
})

test('inventory rolls forward one month-end snapshot per series, never into the current month', async () => {
  const now = new Date()
  const threeMonthsAgoEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 0)).toISOString().slice(0, 10)
  const { sb, inserted } = fakeDb(mondayWeeksAgo(0), 'demo', threeMonthsAgoEnd)
  await ingestMarketData(sb)
  const dates = [...new Set(inserted.inventory.map((r) => r.snapshot_date))].sort()
  assert.equal(dates.length, 2, dates.join(','))
  for (const d of dates) {
    const next = new Date(Date.parse(d) + 864e5)
    assert.equal(next.getUTCDate(), 1, `${d} is not a month-end`)
  }
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  assert.ok(dates.every((d) => d < thisMonthStart))
  for (const r of inserted.inventory) assert.ok(r.on_hand > 0 && r.reorder_point === 100)
})
