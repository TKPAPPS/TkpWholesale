import { NextRequest, NextResponse } from 'next/server'
import { MOCK_USER } from '@/lib/odoo/mock/data'
import { parseSession, refreshSession, sessionCookieMaxAge } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json(MOCK_USER)
  }

  const parsed = parseSession(req)
  if (!parsed || !parsed.uid) {
    return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })
  }

  // Revocation: bounce the session if the Odoo user has since been deactivated
  // (cached ~5 min, so deactivating a customer in Odoo cuts access within minutes).
  const { isUidActive } = await import('@/lib/odoo/odoo-helpers')
  if (!(await isUidActive(parsed.uid))) {
    return NextResponse.json({ error: 'ACCOUNT_DISABLED' }, { status: 401 })
  }

  const res = NextResponse.json({
    uid: parsed.uid,
    partner_id: parsed.partner_id,
    commercial_partner_id: parsed.commercial_partner_id,
    name: parsed.name,
    email: parsed.email,
    lang: parsed.lang,
    pricelist_id: parsed.pricelist_id,
    pricelist_name: parsed.pricelist_name,
  })

  // Roll the session forward. The customer layout polls this endpoint every 5 min
  // and on tab focus, so an active customer's window keeps extending and they are
  // never logged out mid-order. refreshSession returns null once the absolute
  // ceiling (measured from the original login) is reached — then we deliberately
  // leave the existing cookie alone and let it expire on its own, rather than
  // logging the customer out mid-request.
  const rolled = refreshSession(parsed)
  if (rolled) {
    res.cookies.set('session', rolled, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: sessionCookieMaxAge(parsed),
      path: '/',
    })
  }

  return res
}
