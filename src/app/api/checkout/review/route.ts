import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART, MOCK_DELIVERY_ADDRESSES } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

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
    const sessionId = await getOdooSession()
    const { findCart, readCart, emptyCart, fetchDeliveryAddresses, findUnorderableTemplateIdsLive, getAvailableUnitsForOrdering } = await import('@/lib/odoo/odoo-helpers')

    const cartId = await findCart(sessionId, parsed.partner_id)
    const [cart, delivery_addresses] = await Promise.all([
      cartId ? readCart(sessionId, cartId) : Promise.resolve(emptyCart()),
      fetchDeliveryAddresses(sessionId, parsed.commercial_partner_id),
    ])

    // Re-check stock now (the cart may have sat for days): flag any line whose product is no
    // longer orderable so the buyer sees the out-of-stock items split out on the checkout page.
    // Live per-item read (cart is small) so the split shown matches what confirm will enforce.
    const templateIds = cart.lines.map(l => l.template_id)
    const [unorderable, availableMap] = await Promise.all([
      findUnorderableTemplateIdsLive(sessionId, templateIds),
      getAvailableUnitsForOrdering(sessionId, templateIds),
    ])
    // Quantity warning is a per-line preview (informational) — confirm does the authoritative
    // sum-across-lines-per-template check and clamp. Good enough to surface to the buyer here.
    let qtyExceeded = false
    const lines = cart.lines.map(l => {
      if (unorderable.has(l.template_id)) return { ...l, warnings: [...l.warnings, 'OUT_OF_STOCK'] }
      const available = availableMap.get(l.template_id) ?? null
      if (available !== null && l.unit_qty > available) {
        qtyExceeded = true
        return { ...l, warnings: [...l.warnings, 'QTY_EXCEEDS_STOCK'] }
      }
      return l
    })

    const blocking_errors: string[] = []
    if (lines.length === 0) blocking_errors.push('EMPTY')
    if (unorderable.size > 0) blocking_errors.push('OUT_OF_STOCK_ITEMS')
    if (qtyExceeded) blocking_errors.push('QTY_EXCEEDS_STOCK_ITEMS')

    return NextResponse.json({
      ...cart,
      lines,
      valid: blocking_errors.length === 0,
      blocking_errors,
      delivery_addresses,
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('checkout review error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
