import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import TopNav from '@/components/TopNav'
import DataManager from '@/components/data/DataManager'

export default async function DataPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav email={user.email} />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Data</h1>
          <p className="text-sm text-slate-500 mt-1">
            The dataset every fact, forecast and recommendation is computed from. Replace the demo data with your own.
          </p>
        </div>
        <DataManager />
      </main>
    </div>
  )
}
