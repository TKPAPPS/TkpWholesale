import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { devAdminToken } from '@/lib/supabase'
import { checkRateLimit, clientIp, RateLimitConfigError } from '@/lib/rate-limit'

const WIN = '15 m' as const
const WIN_MS = 15 * 60 * 1000

async function applyRateLimit(req: NextRequest, email: string): Promise<NextResponse | null> {
  const ip = clientIp(req)
  try {
    const [ipRes, emailRes] = await Promise.all([
      checkRateLimit('admin', 'ip', ip, 5, WIN, WIN_MS),
      checkRateLimit('admin', 'email', email, 3, WIN, WIN_MS),
    ])
    const hit = ipRes.limited ? ipRes : emailRes.limited ? emailRes : null
    if (!hit) return null
    const res = NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' },
      { status: 429 },
    )
    res.headers.set('Retry-After', String(hit.retryAfter))
    return res
  } catch (err) {
    if (err instanceof RateLimitConfigError) {
      return NextResponse.json({ error: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' }, { status: 503 })
    }
    console.warn('[rate-limit] Unexpected error — failing open:', (err as Error).message ?? err)
    return null
  }
}

function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60,
    path: '/',
  })
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Email and password required.' }, { status: 401 })
  }

  const limited = await applyRateLimit(req, email)
  if (limited) return limited

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase not configured — verify via Odoo /jsonrpc (works with regular passwords on SaaS).
  if (!url || !anonKey || url.includes('your-project')) {
    try {
      const { adminAuthenticate } = await import('@/lib/odoo/client')
      await adminAuthenticate(email, password)
      const res = NextResponse.json({ ok: true, email })
      setSessionCookie(res, devAdminToken())
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
