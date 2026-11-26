'use client'

// Frictionless access:
// - "Continue": signs in; if the email is new, creates the account (pre-confirmed,
//   no email step) and signs in. Any password, short ones included.
// - "Explore without an account": a private guest login remembered in this browser.
// A wrong password for an email that already has an account is still rejected:
// decisions are private to their owner, so accepting it would hand them to anyone.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// Supabase requires 6+ characters. Short passwords are padded the same way every
// time, so they keep working; no existing account can have one shorter than 6.
const normalize = (p: string) => (p.length >= 6 ? p : `${p}${'·'.repeat(6 - p.length)}#dos`)
const GUEST_KEY = 'decisionos.guest'

async function createAccount(email: string, password: string) {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.ok || res.status === 409) return null
  const body = await res.json().catch(() => null)
  return (body?.error as string) ?? 'Could not create the account'
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'continue' | 'guest'>('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace('/dashboard')
    })
  }, [router, supabase.auth])

  function done() {
    const next = new URLSearchParams(window.location.search).get('next')
    router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard')
    router.refresh()
  }

  async function signInOrCreate(e: string, p: string) {
    const pw = normalize(p)
    const first = await supabase.auth.signInWithPassword({ email: e, password: pw })
    if (!first.error) return null
    if (!/invalid login credentials/i.test(first.error.message)) return first.error.message
    // Unknown email or wrong password: try to create the account. If it already
    // exists, creation is a no-op and the retry below reports the wrong password.
    const createErr = await createAccount(e, pw)
    if (createErr) return createErr
    const second = await supabase.auth.signInWithPassword({ email: e, password: pw })
    return second.error ? 'That email already has an account with a different password.' : null
  }

  async function onContinue(ev: React.FormEvent) {
    ev.preventDefault()
    setBusy('continue')
    setError('')
    const err = await signInOrCreate(email.trim().toLowerCase(), password)
    if (err) {
      setError(err)
      setBusy('')
      return
    }
    done()
  }

  async function onGuest() {
    setBusy('guest')
    setError('')
    let guest: { email: string; password: string } | null = null
    try {
      guest = JSON.parse(localStorage.getItem(GUEST_KEY) ?? 'null')
    } catch {}
    if (!guest) {
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      guest = { email: `guest-${id}@example.com`, password: crypto.randomUUID() }
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify(guest))
      } catch {}
    }
    const err = await signInOrCreate(guest.email, guest.password)
    if (err) {
      setError(err)
      setBusy('')
      return
    }
    done()
  }

  const field =
    'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20'

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden lg:flex flex-col justify-between bg-ink px-14 py-12 text-slate-300 overflow-hidden">
        <div className="flex items-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="12" width="5" height="9" rx="1.5" fill="#37a07f" />
            <rect x="8.5" y="6" width="5" height="15" rx="1.5" fill="#6fbfa4" />
            <rect x="16" y="1" width="5" height="20" rx="1.5" fill="#f6f7f5" />
          </svg>
          <span className="text-lg font-semibold tracking-tight text-white">DecisionOS</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white">
            Decide from your numbers, not from the loudest voice in the room.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-400">
            Every week it ranks what needs a decision, explains why with your own sales and stock data, and drafts a
            recommendation you can trace back to the rows it came from.
          </p>
        </div>

        {/* A quiet preview of the product's core move: a ranked issue with its evidence. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 max-w-md">
          <p className="text-xs font-semibold text-[#e0a64a]">Watch</p>
          <p className="mt-1 text-[15px] font-medium text-white">Demand for Garam Masala 100g in South jumped 37%</p>
          <div className="mt-3 flex items-end justify-between">
            <p className="text-sm text-slate-400">Last week vs its average. Check supply keeps up.</p>
            <svg width="96" height="28" viewBox="0 0 96 28" aria-hidden="true">
              <path d="M2,20 L14,17 L26,22 L38,15 L50,18 L62,13 L74,16 L86,8 L94,4" fill="none" stroke="#e0a64a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <rect x="1" y="12" width="5" height="9" rx="1.5" fill="#37a07f" />
              <rect x="8.5" y="6" width="5" height="15" rx="1.5" fill="#0f7b5f" />
              <rect x="16" y="1" width="5" height="20" rx="1.5" fill="#12212e" />
            </svg>
            <span className="text-base font-semibold text-slate-900">DecisionOS</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in or create an account</h2>
          <p className="mt-1.5 text-sm text-slate-500">Use any email and password. New emails get an account instantly.</p>

          <form onSubmit={onContinue} className="mt-8 space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@company.com" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy !== ''}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-[15px] font-medium text-white hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-60 transition"
            >
              {busy === 'continue' ? 'Signing in…' : 'Continue'}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={onGuest}
            disabled={busy !== ''}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-[15px] font-medium text-slate-800 hover:border-slate-400 disabled:opacity-60 transition"
          >
            {busy === 'guest' ? 'Opening…' : 'Explore without an account'}
          </button>
          <p className="mt-3 text-xs text-slate-500">A private guest login is created and remembered in this browser.</p>
        </div>
      </section>
    </div>
  )
}
