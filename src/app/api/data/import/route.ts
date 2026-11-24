// POST /api/data/import — bring your own data.
// multipart/form-data with files skus, sales (required), inventory, signals (optional)
// and field `mode`:
//   validate -> parse + check every row, return counts, row errors, warnings. Writes nothing.
//   import   -> same checks; if clean and `confirm` === 'REPLACE', swap the dataset in one
//               transaction (import_dataset, 0018), then recompute facts so the dashboard
//               and L4 reasoning use the new data immediately.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { isAdmin } from '@/lib/data/admin'
import { DATASETS, LIMITS, validateDataset, type DatasetName } from '@/lib/data/dataset'
import { computeFacts } from '../../../../../scripts/facts/compute.mjs'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(user.email)) {
    return NextResponse.json(
      { error: 'Only admins can import data. Add your email to ADMIN_EMAILS on the server.' },
      { status: 403 },
    )
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  const mode = form.get('mode') === 'import' ? 'import' : 'validate'

  const files: Partial<Record<DatasetName, string>> = {}
  for (const name of DATASETS) {
    const f = form.get(name)
    if (!(f instanceof File) || f.size === 0) continue
    if (f.size > LIMITS.maxBytesPerFile) {
      return NextResponse.json(
        { error: `${name}.csv is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxBytesPerFile / 1048576} MB` },
        { status: 413 },
      )
    }
    files[name] = await f.text()
  }

  const result = validateDataset(files)
  const summary = {
    ok: result.ok,
    counts: result.counts,
    errors: result.errors,
    error_count: result.errorCount,
    warnings: result.warnings,
  }
  if (mode === 'validate' || !result.ok) {
    return NextResponse.json({ mode, ...summary }, { status: result.ok ? 200 : 422 })
  }
  if (form.get('confirm') !== 'REPLACE') {
    return NextResponse.json({ error: 'Type REPLACE to confirm replacing the current dataset.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const t0 = Date.now()
  const { data: job } = await admin.from('job_runs').insert({ job: 'import', status: 'running' }).select('id').single()
  const finish = (status: string, rows: number | null, detail: string) =>
    job?.id != null
      ? admin
          .from('job_runs')
          .update({ status, rows_affected: rows, detail: detail.slice(0, 500), finished_at: new Date().toISOString(), duration_ms: Date.now() - t0 })
          .eq('id', job.id)
      : Promise.resolve()

  const { data: imported, error: importError } = await admin.rpc('import_dataset', {
    p_skus: result.rows.skus,
    p_sales: result.rows.sales,
    p_inventory: result.rows.inventory,
    p_signals: result.rows.signals,
  })
  if (importError) {
    console.error('import_dataset failed', importError)
    await finish('error', null, `import_dataset: ${importError.message}`)
    return NextResponse.json({ error: 'Import failed; the previous dataset is unchanged.' }, { status: 500 })
  }

  // The dataset is already swapped (committed). If recomputing facts fails, say so
  // plainly: the data is in, the nightly pipeline will publish facts on its next run.
  let factsComputed: number | null = null
  let factsError: string | null = null
  try {
    factsComputed = await computeFacts(admin, { ml: false })
  } catch (e) {
    factsError = e instanceof Error ? e.message : String(e)
    console.error('computeFacts after import failed', e)
  }
  await finish(factsError ? 'error' : 'ok', factsComputed, factsError ? `imported; facts failed: ${factsError}` : `imported by ${user.email}`)

  return NextResponse.json({
    mode,
    ...summary,
    imported,
    facts_computed: factsComputed,
    facts_error: factsError
      ? 'Data imported, but recomputing facts failed. Run the pipeline (or wait for the nightly run) to publish facts.'
      : null,
  })
}
