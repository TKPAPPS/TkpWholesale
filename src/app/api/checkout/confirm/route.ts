import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { delivery_address_id, note } = await req.json()

  if (!delivery_address_id) {
    return NextResponse.json({ error: 'INVALID_DELIVERY_ADDRESS', message: 'Delivery address is required.' }, { status: 400 })
  }

  if (USE_MOCK) {
    return NextResponse.json({
      order_id: 789,
      order_name: 'S00123',
      state: 'sale',
      amount_total: 3150.00,
      currency: 'THB',
      already_confirmed: false,
    })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const { findCart } = await import('@/lib/odoo/odoo-helpers')
    const { callKw } = await import('@/lib/odoo/client')

    const cartId = await findCart(parsed.odoo_session_id, parsed.partner_id)
    if (!cartId) {
      return NextResponse.json({ error: 'CART_EMPTY', message: 'No active cart found.' }, { status: 400 })
    }

    // Read current cart state for idempotency check
    const orders = await callKw(parsed.odoo_session_id, 'sale.order', 'read', [[cartId]], {
      fields: ['id', 'name', 'state', 'amount_total', 'currency_id'],
    }) as { id: number; name: string; state: string; amount_total: number; currency_id: [number, string] }[]

    const order = orders[0]
    if (!order) return NextResponse.json({ error: 'CART_EMPTY', message: 'Cart not found.' }, { status: 400 })

    // Idempotency: if already confirmed, return existing order data
    if (order.state === 'sale' || order.state === 'done') {
      return NextResponse.json({
        order_id: order.id,
        order_name: order.name,
        state: order.state,
        amount_total: order.amount_total,
        currency: order.currency_id[1] ?? 'THB',
        already_confirmed: true,
      })
    }

    // Validate delivery address belongs to this commercial partner
    const { fetchDeliveryAddresses } = await import('@/lib/odoo/odoo-helpers')
    const addresses = await fetchDeliveryAddresses(parsed.odoo_session_id, parsed.commercial_partner_id)
    const validAddress = addresses.find(a => a.id === delivery_address_id)
    if (!validAddress) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_ADDRESS', message: 'Delivery address not valid.' }, { status: 400 })
    }

    // Write delivery address and note, then confirm
    await callKw(parsed.odoo_session_id, 'sale.order', 'write', [[cartId], {
      partner_shipping_id: delivery_address_id,
      note: note ?? '',
    }], {})

    await callKw(parsed.odoo_session_id, 'sale.order', 'action_confirm', [[cartId]], {})

    // Re-read to get final state
    const confirmed = await callKw(parsed.odoo_session_id, 'sale.order', 'read', [[cartId]], {
      fields: ['id', 'name', 'state', 'amount_total', 'currency_id'],
    }) as { id: number; name: string; state: string; amount_total: number; currency_id: [number, string] }[]

    const co = confirmed[0]
    return NextResponse.json({
      order_id: co.id,
      order_name: co.name,
      state: co.state,
      amount_total: co.amount_total,
      currency: co.currency_id[1] ?? 'THB',
      already_confirmed: false,
    })
  } catch (err) {
    console.error('checkout confirm error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
