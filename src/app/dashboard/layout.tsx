import { createServerSupabaseClient } from '@/lib/supabase-server'
import Sidebar from '@/components/shell/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen lg:pl-56">
      <Sidebar email={user?.email} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
