import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { delivery_address_id, note, po_ref, delivery_date } = await req.json()

  if (!Number.isInteger(delivery_address_id) || delivery_address_id <= 0) {
    return NextResponse.json({ error: 'INVALID_DELIVERY_ADDRESS', message: 'Delivery address is required.' }, { status: 400 })
  }

  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) {
    return NextResponse.json({ error: 'INVALID_NOTE', message: 'Note must be a string under 2000 characters.' }, { status: 400 })
  }

  // Optional PO / customer reference (maps to sale.order.client_order_ref).
  if (po_ref !== undefined && (typeof po_ref !== 'string' || po_ref.length > 100)) {
    return NextResponse.json({ error: 'INVALID_PO_REF', message: 'Reference must be under 100 characters.' }, { status: 400 })
  }

  // Optional requested delivery date YYYY-MM-DD (maps to sale.order.commitment_date). Must be
  // a valid date and not in the past.
  let commitmentDate: string | null = null
  if (delivery_date !== undefined && delivery_date !== null && delivery_date !== '') {
    if (typeof delivery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(delivery_date) || Number.isNaN(Date.parse(delivery_date))) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_DATE', message: 'Delivery date is invalid.' }, { status: 400 })
    }
    const today = new Date().toISOString().slice(0, 10)
    if (delivery_date < today) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_DATE', message: 'Delivery date cannot be in the past.' }, { status: 400 })
    }
    commitmentDate = `${delivery_date} 09:00:00`
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
    const sessionId = await getOdooSession()
    const { findCart, findUnorderableTemplateIds } = await import('@/lib/odoo/odoo-helpers')
    const { callKw, searchRead } = await import('@/lib/odoo/client')

    const cartId = await findCart(sessionId, parsed.partner_id)
    if (!cartId) {
      return NextResponse.json({ error: 'CART_EMPTY', message: 'No active cart found.' }, { status: 400 })
    }

    // Read current cart state for idempotency check
    const orders = await callKw(sessionId, 'sale.order', 'read', [[cartId]], {
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

    // Hard stock re-check (safety net even if the review was stale): refuse to confirm an order
    // that contains an item which is now out of stock and not allow-out-of-stock.
    const lineRows = await searchRead(sessionId, 'sale.order.line',
      [['order_id', '=', cartId]], ['product_template_id'],
    ) as { product_template_id: [number, string] | false }[]
    const lineTemplateIds = lineRows.map(r => (Array.isArray(r.product_template_id) ? r.product_template_id[0] : 0)).filter(Boolean)
    const unorderable = await findUnorderableTemplateIds(sessionId, lineTemplateIds)
    if (unorderable.size > 0) {
      return NextResponse.json(
        { error: 'ITEMS_OUT_OF_STOCK', message: 'Some items are no longer in stock. Please review your cart.' },
        { status: 409 },
      )
    }

    // Validate delivery address belongs to this commercial partner
    const { fetchDeliveryAddresses } = await import('@/lib/odoo/odoo-helpers')
    const addresses = await fetchDeliveryAddresses(sessionId, parsed.commercial_partner_id)
    const validAddress = addresses.find(a => a.id === delivery_address_id)
    if (!validAddress) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_ADDRESS', message: 'Delivery address not valid.' }, { status: 400 })
    }

    // Write delivery address, note, optional PO ref + requested delivery date, and stamp
    // date_order to now (prevents stale draft dates).
    const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const writeVals: Record<string, unknown> = {
      partner_shipping_id: delivery_address_id,
      note: note ?? '',
      date_order: nowUtc,
    }
    if (typeof po_ref === 'string' && po_ref.trim()) writeVals.client_order_ref = po_ref.trim()
    if (commitmentDate) writeVals.commitment_date = commitmentDate
    await callKw(sessionId, 'sale.order', 'write', [[cartId], writeVals], {})

    await callKw(sessionId, 'sale.order', 'action_confirm', [[cartId]], {})

    // Re-read to get final state
    const confirmed = await callKw(sessionId, 'sale.order', 'read', [[cartId]], {
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
    invalidateOdooSession()
    console.error('checkout confirm error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
