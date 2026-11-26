// Server-side loader: reads the raw tables the action engine needs and shapes them
// into SeriesInput[]. Runs under the signed-in user's session (row-level security).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SeriesInput } from './engine'

const PAGE = 1000 // PostgREST caps responses at 1000 rows; page so big datasets are not cut

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

export const mondayOf = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10)

export async function loadSeries(supabase: SupabaseClient, historyWeeks = 26): Promise<SeriesInput[]> {
  const since = new Date(Date.now() - historyWeeks * 7 * 864e5).toISOString().slice(0, 10)
  const [skus, inventory, velocity] = await Promise.all([
    all<{ sku_id: string; name: string; unit_cost: number }>((f, t) => supabase.from('sku').select('sku_id,name,unit_cost').order('sku_id').range(f, t)),
    all<{ sku_id: string; region: string; snapshot_date: string; on_hand: number; reorder_point: number }>((f, t) =>
      supabase.from('inventory').select('sku_id,region,snapshot_date,on_hand,reorder_point').order('snapshot_date', { ascending: false }).order('id').range(f, t),
    ),
    all<{ sku_id: string; region: string; week: string; units: number; revenue: number }>((f, t) =>
      supabase.from('v_sku_velocity').select('sku_id,region,week,units,revenue').gte('week', since).order('week').order('sku_id').order('region').range(f, t),
    ),
  ])

  const sku = new Map(skus.map((s) => [s.sku_id, s]))
  const latestStock = new Map<string, (typeof inventory)[number]>()
  for (const r of inventory) {
    const k = `${r.sku_id}|${r.region}`
    if (!latestStock.has(k)) latestStock.set(k, r) // rows arrive newest first
  }
  const byPair = new Map<string, typeof velocity>()
  for (const r of velocity) {
    const k = `${r.sku_id}|${r.region}`
    if (!byPair.has(k)) byPair.set(k, [])
    byPair.get(k)!.push(r)
  }

  const out: SeriesInput[] = []
  for (const [k, stock] of latestStock) {
    const s = sku.get(stock.sku_id)
    const v = byPair.get(k)
    if (!s || !v?.length) continue
    const recent = v.slice(-8)
    const units = recent.reduce((a, r) => a + Number(r.units), 0)
    const revenue = recent.reduce((a, r) => a + Number(r.revenue), 0)
    out.push({
      sku: s.sku_id,
      name: s.name,
      region: stock.region,
      weeks: v.map((r) => ({ week: r.week, units: Number(r.units) })),
      unitPrice: units ? revenue / units : 0,
      unitCost: Number(s.unit_cost),
      onHand: Number(stock.on_hand),
      reorderPoint: Number(stock.reorder_point),
      stockAsOf: new Date(stock.snapshot_date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    })
  }
  return out
}
