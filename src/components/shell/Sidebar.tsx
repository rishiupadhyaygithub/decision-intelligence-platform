'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutGrid, ListChecks, PenLine, Database, BookOpen, LineChart, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard', label: 'Brief', icon: LayoutGrid, exact: true },
  { href: '/dashboard/new-decision', label: 'New decision', icon: PenLine },
  { href: '/dashboard/inbox', label: 'Decisions', icon: ListChecks },
  { href: '/dashboard/retros', label: 'Track record', icon: LineChart },
  { href: '/dashboard/memory', label: 'Lessons', icon: BookOpen },
  { href: '/dashboard/data', label: 'Data', icon: Database },
]

export default function Sidebar({ email }: { email?: string | null }) {
  const path = usePathname()
  const router = useRouter()

  async function signOut() {
    await createClient().auth.signOut().catch(() => {})
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <aside className="lg:fixed lg:inset-y-0 lg:left-0 lg:w-56 bg-ink text-slate-300 flex lg:flex-col">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-4 lg:py-6 shrink-0">
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <rect x="1" y="12" width="5" height="9" rx="1.5" fill="#37a07f" />
          <rect x="8.5" y="6" width="5" height="15" rx="1.5" fill="#6fbfa4" />
          <rect x="16" y="1" width="5" height="20" rx="1.5" fill="#f6f7f5" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight text-white">DecisionOS</span>
      </Link>

      <nav className="flex lg:flex-col gap-0.5 px-2 lg:px-3 overflow-x-auto lg:overflow-visible items-center lg:items-stretch">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? path === href : path === href || path.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                active ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon size={16} className={active ? 'text-[#6fbfa4]' : 'text-slate-400 group-hover:text-slate-200'} />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="hidden lg:block mt-auto px-5 py-5 border-t border-white/10">
        {email && <p className="text-xs text-slate-400 truncate mb-2" title={email}>{email}</p>}
        <button onClick={signOut} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors">
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </aside>
  )
}
