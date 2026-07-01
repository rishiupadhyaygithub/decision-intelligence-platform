'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Brand } from './decisionos'

export default function TopNav({ email }: { email?: string }) {
  const path = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    try {
      await supabase.auth.signOut()
      router.push('/auth/login')
      router.refresh()
    } catch {
      router.push('/auth/login')
    }
  }

  const tab = (href: string, label: string) => {
    const active = path === href || (href !== '/dashboard' && path.startsWith(href))
    return (
      <Link
        href={href}
        className={`text-sm px-3 py-1.5 rounded-md ${
          active ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-900'
        }`}
      >
        {label}
      </Link>
    )
  }

  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Brand />
          <div className="hidden sm:flex items-center gap-1">
            {tab('/dashboard', 'Dashboard')}
            {tab('/dashboard/new-decision', 'New decision')}
            {tab('/dashboard/memory', 'Memory')}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {email && <span className="text-xs text-slate-400 hidden sm:inline">{email}</span>}
          <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </div>
    </nav>
  )
}
