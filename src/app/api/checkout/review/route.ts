import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART, MOCK_DELIVERY_ADDRESSES } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json({
      ...MOCK_CART,
      valid: true,
      blocking_errors: [],
      delivery_addresses: MOCK_DELIVERY_ADDRESSES,
    })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const { findCart, readCart, emptyCart, fetchDeliveryAddresses } = await import('@/lib/odoo/odoo-helpers')

    const cartId = await findCart(parsed.odoo_session_id, parsed.partner_id)
    const [cart, delivery_addresses] = await Promise.all([
      cartId ? readCart(parsed.odoo_session_id, cartId) : Promise.resolve(emptyCart()),
      fetchDeliveryAddresses(parsed.odoo_session_id, parsed.commercial_partner_id),
    ])

    const blocking_errors: string[] = []
    if (cart.lines.length === 0) blocking_errors.push('Cart is empty.')

    return NextResponse.json({
      ...cart,
      valid: blocking_errors.length === 0,
      blocking_errors,
      delivery_addresses,
    })
  } catch (err) {
    console.error('checkout review error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
