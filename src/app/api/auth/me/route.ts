import { NextRequest, NextResponse } from 'next/server'
import { MOCK_USER } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

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

  return NextResponse.json({
    uid: parsed.uid,
    partner_id: parsed.partner_id,
    commercial_partner_id: parsed.commercial_partner_id,
    name: parsed.name,
    email: parsed.email,
    lang: parsed.lang,
    pricelist_id: parsed.pricelist_id,
    pricelist_name: parsed.pricelist_name,
  })
}
