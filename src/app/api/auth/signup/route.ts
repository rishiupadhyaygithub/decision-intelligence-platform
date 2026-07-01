import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase-admin'

// Public signup that bypasses email confirmation: creates a pre-confirmed user
// with the service-role key (free tier has no SMTP, so the confirm email never
// arrives). The client then signs in with the same credentials. Service role is
// used only server-side; never exposed to the browser.
const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
})

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password (min 6 chars) required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  })
  if (error) {
    const already = /already|exists|registered/i.test(error.message)
    return NextResponse.json(
      { error: already ? 'Account already exists — just sign in.' : error.message },
      { status: already ? 409 : 500 },
    )
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
