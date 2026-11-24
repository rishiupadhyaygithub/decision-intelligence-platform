// GET /api/data/export?dataset=skus|sales|inventory|signals — the current dataset as
// CSV in the exact import format. Doubles as the backup you take before replacing data,
// and as a template for preparing your own files.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { COLUMNS, DATASETS, type DatasetName } from '@/lib/data/dataset'
import { toCsv } from '@/lib/data/csv'

const TABLE: Record<DatasetName, { table: string; order: string }> = {
  skus: { table: 'sku', order: 'sku_id' },
  sales: { table: 'sales', order: 'id' },
  inventory: { table: 'inventory', order: 'id' },
  signals: { table: 'competitor_signal', order: 'id' },
}
const PAGE = 1000 // PostgREST's default max rows per request

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dataset = new URL(request.url).searchParams.get('dataset') as DatasetName | null
  if (!dataset || !DATASETS.includes(dataset)) {
    return NextResponse.json({ error: `dataset must be one of ${DATASETS.join(', ')}` }, { status: 400 })
  }

  const { table, order } = TABLE[dataset]
  const cols = COLUMNS[dataset]
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(cols.join(','))
      .order(order)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('data export failed', error)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]))
    if (!data || data.length < PAGE) break
  }

  return new NextResponse(toCsv(cols, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${dataset}.csv"`,
    },
  })
}
