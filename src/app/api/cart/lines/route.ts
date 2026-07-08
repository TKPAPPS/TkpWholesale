import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { product_id, packaging_id, packaging_qty } = await req.json()

  if (!Number.isInteger(product_id) || product_id <= 0 ||
      !Number.isInteger(packaging_qty) || packaging_qty <= 0) {
    return NextResponse.json({ error: 'INVALID_QTY', message: 'packaging_qty must be a positive integer.' }, { status: 400 })
  }

  if (USE_MOCK) return NextResponse.json(MOCK_CART)

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { getOrCreateCart, validatePackaging, fetchWebsitePublishedSettings, readCart } = await import('@/lib/odoo/odoo-helpers')
    const { callKw, searchRead } = await import('@/lib/odoo/client')

    // Run all independent operations in parallel, including published-status check.
    // We deliberately do NOT compute price_unit here — the cart carries the partner's current
    // pricelist (Odoo sets it from the partner on create), so Odoo computes the exact line
    // price natively. That keeps card/cart/review/Odoo prices identical.
    const [pkgInfo, cartId, publishedMap] = await Promise.all([
      validatePackaging(sessionId, product_id, packaging_id ?? 0),
      getOrCreateCart(sessionId, parsed.partner_id),
      fetchWebsitePublishedSettings(sessionId),
    ])

    // Reject orders for products not published on the portal
    if (!publishedMap.has(product_id)) {
      return NextResponse.json({ error: 'PRODUCT_NOT_AVAILABLE' }, { status: 404 })
    }

    if (!pkgInfo) {
      return NextResponse.json({ error: 'INVALID_PACKAGING', message: 'Packaging not valid for this product.' }, { status: 400 })
    }

    // Check for existing line with the SAME product AND the same packaging.
    // When packaging_id is falsy (the "Unit" fallback, id 0), match only lines
    // that also have NO packaging — otherwise a unit add merges into a real
    // "Case of 12" line and corrupts its quantities.
    const existingLines = await searchRead(
      sessionId, 'sale.order.line',
      [['order_id', '=', cartId], ['product_id', '=', pkgInfo.productVariantId],
       packaging_id ? ['product_packaging_id', '=', packaging_id] : ['product_packaging_id', '=', false]],
      ['id', 'product_packaging_qty', 'product_uom_qty'],
      { limit: 1 },
    ) as { id: number; product_packaging_qty: number; product_uom_qty: number }[]

    if (existingLines.length > 0) {
      // Merge on the unit quantity (product_uom_qty is always accurate), not on
      // product_packaging_qty, which Odoo reports as 0 for no-packaging lines and
      // would reset the quantity instead of adding to it.
      const addedUnits = packaging_qty * pkgInfo.qty
      const newUnitQty = existingLines[0].product_uom_qty + addedUnits
      // No price_unit: Odoo recomputes it from the order pricelist when qty changes.
      const writeVals: Record<string, unknown> = {
        product_uom_qty: newUnitQty,
      }
      if (packaging_id) writeVals.product_packaging_qty = existingLines[0].product_packaging_qty + packaging_qty
      await callKw(sessionId, 'sale.order.line', 'write', [[existingLines[0].id], writeVals], {})
    } else {
      // No price_unit: Odoo computes it from the order pricelist on create.
      const lineVals: Record<string, unknown> = {
        order_id: cartId,
        product_id: pkgInfo.productVariantId,
        product_packaging_qty: packaging_qty,
        product_uom_qty: packaging_qty * pkgInfo.qty,
      }
      if (packaging_id) lineVals.product_packaging_id = packaging_id
      await callKw(sessionId, 'sale.order.line', 'create', [lineVals], {})
    }

    // Return the updated cart so the client reconciles in one round-trip
    // (no separate GET /api/cart needed).
    const cart = await readCart(sessionId, cartId)
    return NextResponse.json(cart)
  } catch (err) {
    invalidateOdooSession()
    console.error('cart lines POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
