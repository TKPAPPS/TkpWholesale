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
    const { getOrCreateCart, validatePackaging, lookupPricelistPrice, fetchWebsitePublishedSettings, readCart } = await import('@/lib/odoo/odoo-helpers')
    const { callKw, searchRead } = await import('@/lib/odoo/client')

    // Run all independent operations in parallel, including published-status check
    const [pkgInfo, priceUnit, cartId, publishedMap] = await Promise.all([
      validatePackaging(sessionId, product_id, packaging_id ?? 0),
      lookupPricelistPrice(sessionId, parsed.pricelist_id, product_id),
      getOrCreateCart(sessionId, parsed.partner_id, parsed.pricelist_id),
      fetchWebsitePublishedSettings(sessionId),
    ])

    // Reject orders for products not published on the portal
    if (!publishedMap.has(product_id)) {
      return NextResponse.json({ error: 'PRODUCT_NOT_AVAILABLE' }, { status: 404 })
    }

    if (!pkgInfo) {
      return NextResponse.json({ error: 'INVALID_PACKAGING', message: 'Packaging not valid for this product.' }, { status: 400 })
    }

    // Check for existing line with same product + packaging
    const existingLines = await searchRead(
      sessionId, 'sale.order.line',
      [['order_id', '=', cartId], ['product_id', '=', pkgInfo.productVariantId],
       ...(packaging_id ? [['product_packaging_id', '=', packaging_id]] : [])],
      ['id', 'product_packaging_qty'],
      { limit: 1 },
    ) as { id: number; product_packaging_qty: number }[]

    if (existingLines.length > 0) {
      const newQty = existingLines[0].product_packaging_qty + packaging_qty
      const writeVals: Record<string, unknown> = {
        product_packaging_qty: newQty,
        product_uom_qty: newQty * pkgInfo.qty,
      }
      if (priceUnit !== null) writeVals.price_unit = priceUnit
      await callKw(sessionId, 'sale.order.line', 'write', [[existingLines[0].id], writeVals], {})
    } else {
      const lineVals: Record<string, unknown> = {
        order_id: cartId,
        product_id: pkgInfo.productVariantId,
        product_packaging_qty: packaging_qty,
        product_uom_qty: packaging_qty * pkgInfo.qty,
      }
      if (packaging_id) lineVals.product_packaging_id = packaging_id
      if (priceUnit !== null) lineVals.price_unit = priceUnit
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
