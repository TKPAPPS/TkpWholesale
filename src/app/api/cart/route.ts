import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) return NextResponse.json(MOCK_CART)

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { findCart, readCart, emptyCart } = await import('@/lib/odoo/odoo-helpers')
    const cartId = await findCart(sessionId, parsed.partner_id)
    if (!cartId) return NextResponse.json(emptyCart())
    const cart = await readCart(sessionId, cartId)
    return NextResponse.json(cart)
  } catch (err) {
    invalidateOdooSession()
    console.error('cart GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) return NextResponse.json({ cleared: true })

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { findCart, emptyCart } = await import('@/lib/odoo/odoo-helpers')
    const { callKw } = await import('@/lib/odoo/client')

    const cartId = await findCart(sessionId, parsed.partner_id)
    if (cartId) {
      await callKw(sessionId, 'sale.order', 'write', [[cartId], { order_line: [[5, 0, 0]] }], {})
    }

    return NextResponse.json(emptyCart())
  } catch (err) {
    invalidateOdooSession()
    console.error('cart DELETE error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
