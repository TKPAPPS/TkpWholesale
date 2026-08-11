import { NextRequest, NextResponse } from 'next/server'
import { MOCK_USER } from '@/lib/odoo/mock/data'
import { signSession } from '@/lib/odoo/session'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function POST(req: NextRequest) {
  // Throttle by IP before doing any auth work - 10 attempts per 10 minutes.
  const allowed = await checkRateLimit(`login:${clientIp(req)}`, 10, 600)
  if (!allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }

  const { login, password } = await req.json()

  if (!login || !password) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Email and password required.' }, { status: 401 })
  }

  if (USE_MOCK) {
    // --- MOCK MODE ---
    if (!login.includes('@')) {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, { status: 401 })
    }
    try {
      const user = { ...MOCK_USER, email: login }
      const res = NextResponse.json({ user })
      res.cookies.set('session', signSession({
        uid: user.uid,
        partner_id: user.partner_id,
        commercial_partner_id: user.commercial_partner_id,
        odoo_session_id: 'mock',
      }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 4 * 60 * 60, path: '/' })
      return res
    } catch {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURATION', message: 'Server configuration error. Please contact the administrator.' }, { status: 503 })
    }
  }

  // --- REAL ODOO MODE ---
  if (process.env.NODE_ENV === 'production' && process.env.SKIP_PORTAL_CHECK === 'true') {
    console.error('FATAL: SKIP_PORTAL_CHECK=true in production. Remove this env var before going live.')
    return NextResponse.json({ error: 'SERVER_MISCONFIGURATION', message: 'Server is misconfigured.' }, { status: 500 })
  }

  const { odooAuthenticate, verifyPortalUser, callKw } = await import('@/lib/odoo/client')

  try {
    const auth = await odooAuthenticate(login, password)

    const skipPortalCheck = process.env.SKIP_PORTAL_CHECK === 'true'
    if (!skipPortalCheck) {
      const isPortal = await verifyPortalUser(auth.session_id, auth.uid)
      if (!isPortal) {
        return NextResponse.json({ error: 'NOT_PORTAL_USER', message: 'Access restricted to portal users.' }, { status: 403 })
      }
    }

    const partners = await callKw(auth.session_id, 'res.partner', 'read', [[auth.partner_id]], {
      fields: ['id', 'name', 'email', 'lang', 'commercial_partner_id', 'property_product_pricelist'],
    }) as { id: number; name: string; email: string; lang: string; commercial_partner_id: [number, string]; property_product_pricelist: [number, string] }[]

    const partner = partners[0]
    const lang = partner.lang === 'he_IL' ? 'he' : 'en'

    const user = {
      uid: auth.uid,
      partner_id: partner.id,
      commercial_partner_id: partner.commercial_partner_id[0],
      name: partner.name,
      email: partner.email,
      lang,
      pricelist_id: partner.property_product_pricelist?.[0] ?? null,
      pricelist_name: partner.property_product_pricelist?.[1] ?? '',
    }

    const res = NextResponse.json({ user })
    res.cookies.set('session', signSession({
      uid: auth.uid,
      partner_id: partner.id,
      commercial_partner_id: partner.commercial_partner_id[0],
      lang,
      pricelist_id: user.pricelist_id,
      name: user.name,
      email: user.email,
      pricelist_name: user.pricelist_name,
    }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 4 * 60 * 60, path: '/' })

    return res
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'INVALID_CREDENTIALS') {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, { status: 401 })
    }
    console.error('Odoo login error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
