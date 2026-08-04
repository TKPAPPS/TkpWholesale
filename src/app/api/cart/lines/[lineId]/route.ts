import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'
const WEBSITE_ID = Number(process.env.ODOO_WEBSITE_ID ?? 3)

async function resolveCartForLine(sessionId: string, lineId: number, partnerId: number) {
  const { searchRead, callKw } = await import('@/lib/odoo/client')

  const lines = await searchRead(sessionId, 'sale.order.line',
    [['id', '=', lineId]],
    ['id', 'order_id', 'product_packaging_qty', 'product_packaging_id', 'product_template_id'],
    { limit: 1 },
  ) as { id: number; order_id: [number, string]; product_packaging_qty: number; product_packaging_id: [number, string] | false; product_template_id: [number, string] }[]

  if (!lines[0]) return null

  const orderId = lines[0].order_id[0]

  // Verify ownership: the order must be a PORTAL cart — belong to this partner, be
  // in draft state, AND carry this website_id. Without the website_id check a portal
  // user could edit/delete lines of a staff-created backoffice quotation for their
  // own partner (findCart enforces the same filter; docs/security-rules.md requires it).
  const orders = await callKw(sessionId, 'sale.order', 'read', [[orderId]], {
    fields: ['id', 'partner_id', 'state', 'website_id'],
  }) as { id: number; partner_id: [number, string]; state: string; website_id: [number, string] | false }[]

  const order = orders[0]
  if (!order || order.partner_id[0] !== partnerId || order.state !== 'draft') return null
  const orderWebsiteId = Array.isArray(order.website_id) ? order.website_id[0] : null
  if (orderWebsiteId !== WEBSITE_ID) return null

  // Fetch units per package so product_uom_qty stays in sync with packaging qty
  let unitsPerPack = 1
  const packagingId = lines[0].product_packaging_id ? lines[0].product_packaging_id[0] : null
  if (packagingId) {
    const pkgs = await callKw(sessionId, 'product.packaging', 'read', [[packagingId]], {
      fields: ['id', 'qty'],
    }) as { id: number; qty: number }[]
    if (pkgs[0]) unitsPerPack = pkgs[0].qty
  }

  const templateId = lines[0].product_template_id ? lines[0].product_template_id[0] : null
  return { lineId: lines[0].id, orderId, unitsPerPack, templateId }
}

export async function PATCH(req: NextRequest, { params }: { params: { lineId: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { packaging_qty } = await req.json()
  if (!Number.isInteger(packaging_qty) || packaging_qty <= 0) {
    return NextResponse.json({ error: 'INVALID_QTY' }, { status: 400 })
  }

  if (USE_MOCK) return NextResponse.json(MOCK_CART)

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead } = await import('@/lib/odoo/client')
    const { readCart, getAvailableUnitsForOrdering } = await import('@/lib/odoo/odoo-helpers')

    const lineId = Number(params.lineId)
    if (!Number.isInteger(lineId) || lineId <= 0) {
      return NextResponse.json({ error: 'LINE_NOT_FOUND' }, { status: 404 })
    }
    const resolved = await resolveCartForLine(sessionId, lineId, parsed.partner_id)
    if (!resolved) return NextResponse.json({ error: 'LINE_NOT_FOUND' }, { status: 404 })

    // Quantity cap: sum the OTHER lines for this same template in the cart (stock is
    // tracked per template, so a customer could otherwise bypass the cap by splitting
    // across packagings), add this line's new requested total, compare to what's available.
    const requestedUnits = packaging_qty * resolved.unitsPerPack
    if (resolved.templateId) {
      const [availableMap, siblingLines] = await Promise.all([
        getAvailableUnitsForOrdering(sessionId, [resolved.templateId]),
        searchRead(sessionId, 'sale.order.line',
          [['order_id', '=', resolved.orderId], ['product_template_id', '=', resolved.templateId], ['id', '!=', resolved.lineId]],
          ['product_uom_qty'],
        ) as Promise<{ product_uom_qty: number }[]>,
      ])
      const available = availableMap.get(resolved.templateId) ?? null
      const otherCommitted = siblingLines.reduce((s, l) => s + l.product_uom_qty, 0)
      if (available !== null && otherCommitted + requestedUnits > available) {
        const remainingUnits = Math.max(0, available - otherCommitted)
        const availablePacks = Math.floor(remainingUnits / resolved.unitsPerPack)
        return NextResponse.json({
          error: 'INSUFFICIENT_STOCK',
          message: availablePacks > 0 ? `Only ${availablePacks} available.` : 'No more available.',
          available_units: remainingUnits,
          available_packs: availablePacks,
        }, { status: 409 })
      }
    }

    // No price_unit: Odoo recomputes it from the order's pricelist when product_uom_qty changes.
    const writeVals: Record<string, unknown> = {
      product_packaging_qty: packaging_qty,
      product_uom_qty: requestedUnits,
    }
    await callKw(sessionId, 'sale.order.line', 'write',
      [[resolved.lineId], writeVals], {})

    const cart = await readCart(sessionId, resolved.orderId)
    return NextResponse.json(cart)
  } catch (err) {
    invalidateOdooSession()
    console.error('cart line PATCH error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { lineId: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    const updatedCart = { ...MOCK_CART, lines: MOCK_CART.lines.filter((l) => l.line_id !== Number(params.lineId)) }
    return NextResponse.json(updatedCart)
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { callKw } = await import('@/lib/odoo/client')
    const { readCart } = await import('@/lib/odoo/odoo-helpers')

    const lineId = Number(params.lineId)
    if (!Number.isInteger(lineId) || lineId <= 0) {
      return NextResponse.json({ error: 'LINE_NOT_FOUND' }, { status: 404 })
    }
    const resolved = await resolveCartForLine(sessionId, lineId, parsed.partner_id)
    if (!resolved) return NextResponse.json({ error: 'LINE_NOT_FOUND' }, { status: 404 })

    await callKw(sessionId, 'sale.order.line', 'unlink', [[resolved.lineId]], {})

    const cart = await readCart(sessionId, resolved.orderId)
    return NextResponse.json(cart)
  } catch (err) {
    invalidateOdooSession()
    console.error('cart line DELETE error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
