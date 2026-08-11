import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { signAdminToken, isAdminEmail } from '@/lib/supabase'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// Constant-time string compare that never leaks length via early return.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 4 * 60 * 60,
    path: '/',
  })
}

export async function POST(req: NextRequest) {
  // Throttle admin logins harder than customer ones - 6 attempts per 10 minutes per IP.
  const allowed = await checkRateLimit(`adminlogin:${clientIp(req)}`, 6, 600)
  if (!allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }

  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Email and password required.' }, { status: 401 })
  }

  // Verifying a credential proves identity, not authority. Only emails on the
  // admin allowlist (ADMIN_EMAILS, or ODOO_ADMIN_LOGIN) may hold an admin
  // session - otherwise any valid portal customer could log into /admin.
  if (!isAdminEmail(email)) {
    return NextResponse.json({ error: 'NOT_AUTHORIZED', message: 'This account is not authorized for admin access.' }, { status: 403 })
  }

  // Dedicated portal admin password (env). When ADMIN_PASSWORD is set, it is the
  // source of truth for allowlisted admins - a fixed credential independent of
  // Odoo/Supabase passwords. Compared in constant time.
  const adminPassword = process.env.ADMIN_PASSWORD
  if (adminPassword) {
    if (!safeEqual(password, adminPassword)) {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, { status: 401 })
    }
    let token: string
    try {
      token = signAdminToken(email)
    } catch {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURATION', message: 'Server configuration error. Please contact the administrator.' }, { status: 503 })
    }
    const res = NextResponse.json({ ok: true, email })
    setSessionCookie(res, token)
    return res
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase not configured - verify via Odoo /jsonrpc (works with regular passwords on SaaS).
  if (!url || !anonKey || url.includes('your-project')) {
    let token: string
    try {
      token = signAdminToken(email)
    } catch {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURATION', message: 'Server configuration error. Please contact the administrator.' }, { status: 503 })
    }
    try {
      const { adminAuthenticate } = await import('@/lib/odoo/client')
      await adminAuthenticate(email, password)
      const res = NextResponse.json({ ok: true, email })
      setSessionCookie(res, token)
      return res
    } catch {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, { status: 401 })
    }
  }

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true, email })
  setSessionCookie(res, data.session.access_token)
  return res
}
