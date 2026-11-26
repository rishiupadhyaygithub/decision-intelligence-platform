import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import DataManager from '@/components/data/DataManager'

export default async function DataPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-4xl px-5 sm:px-8 py-8 lg:py-12 space-y-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">Your data</h1>
          <p className="mt-2 max-w-2xl text-base text-slate-600">
            Everything on the Brief, every forecast and every recommendation is computed from these four tables. Swap the demo data for your own sales, stock and market signals.
          </p>
        </div>
        <DataManager />
      </main>
    </div>
  )
}
