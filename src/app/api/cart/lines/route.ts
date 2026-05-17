import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { product_id, packaging_id, packaging_qty } = await req.json()

  if (!product_id || packaging_qty == null || packaging_qty <= 0) {
    return NextResponse.json({ error: 'INVALID_QTY', message: 'packaging_qty must be a positive integer.' }, { status: 400 })
  }

  if (USE_MOCK) return NextResponse.json(MOCK_CART)

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const { getOrCreateCart, validatePackaging, readCart, lookupPricelistPrice } = await import('@/lib/odoo/odoo-helpers')
    const { callKw, searchRead } = await import('@/lib/odoo/client')

    // Validate packaging belongs to this template
    const pkgInfo = await validatePackaging(parsed.odoo_session_id, product_id, packaging_id ?? 0)
    if (!pkgInfo) {
      return NextResponse.json({ error: 'INVALID_PACKAGING', message: 'Packaging not valid for this product.' }, { status: 400 })
    }

    // Look up the customer's pricelist price so price_unit is correct on the order line.
    // Odoo create() / write() skip onchanges, so we must set price_unit explicitly.
    const priceUnit = await lookupPricelistPrice(parsed.odoo_session_id, parsed.pricelist_id, product_id)

    const cartId = await getOrCreateCart(parsed.odoo_session_id, parsed.partner_id, parsed.pricelist_id)

    // Check if a line with the same product + packaging already exists
    const existingLines = await searchRead(
      parsed.odoo_session_id, 'sale.order.line',
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
      await callKw(parsed.odoo_session_id, 'sale.order.line', 'write',
        [[existingLines[0].id], writeVals], {})
    } else {
      const lineVals: Record<string, unknown> = {
        order_id: cartId,
        product_id: pkgInfo.productVariantId,
        product_packaging_qty: packaging_qty,
        product_uom_qty: packaging_qty * pkgInfo.qty,
      }
      if (packaging_id) lineVals.product_packaging_id = packaging_id
      if (priceUnit !== null) lineVals.price_unit = priceUnit
      await callKw(parsed.odoo_session_id, 'sale.order.line', 'create', [lineVals], {})
    }

    const cart = await readCart(parsed.odoo_session_id, cartId)
    return NextResponse.json(cart)
  } catch (err) {
    console.error('cart lines POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
