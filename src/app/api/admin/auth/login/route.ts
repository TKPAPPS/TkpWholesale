import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { devAdminToken } from '@/lib/supabase'

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase not configured — check against ODOO_ADMIN_LOGIN + ODOO_ADMIN_API_KEY env vars.
  // Login with: email = ODOO_ADMIN_LOGIN, password = ODOO_ADMIN_API_KEY
  if (!url || !anonKey || url.includes('your-project')) {
    const adminEmail = process.env.ODOO_ADMIN_LOGIN
    const adminKey = process.env.ODOO_ADMIN_API_KEY
    if (!adminEmail || !adminKey || email !== adminEmail || password !== adminKey) {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or API key.' }, { status: 401 })
    }
    const res = NextResponse.json({ ok: true, email })
    setSessionCookie(res, devAdminToken())
    return res
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
