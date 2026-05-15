import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CART } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

async function resolveCartForLine(sessionId: string, lineId: number, partnerId: number) {
  const { searchRead, callKw } = await import('@/lib/odoo/client')

  const lines = await searchRead(sessionId, 'sale.order.line',
    [['id', '=', lineId]],
    ['id', 'order_id', 'product_packaging_qty'],
    { limit: 1 },
  ) as { id: number; order_id: [number, string]; product_packaging_qty: number }[]

  if (!lines[0]) return null

  const orderId = lines[0].order_id[0]

  // Verify ownership: order must belong to this partner and be in draft state
  const orders = await callKw(sessionId, 'sale.order', 'read', [[orderId]], {
    fields: ['id', 'partner_id', 'state'],
  }) as { id: number; partner_id: [number, string]; state: string }[]

  const order = orders[0]
  if (!order || order.partner_id[0] !== partnerId || order.state !== 'draft') return null

  return { lineId: lines[0].id, orderId }
}

export async function PATCH(req: NextRequest, { params }: { params: { lineId: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { packaging_qty } = await req.json()
  if (!packaging_qty || packaging_qty <= 0) {
    return NextResponse.json({ error: 'INVALID_QTY' }, { status: 400 })
  }

  if (USE_MOCK) return NextResponse.json(MOCK_CART)

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const { callKw } = await import('@/lib/odoo/client')
    const { readCart } = await import('@/lib/odoo/odoo-helpers')

    const lineId = Number(params.lineId)
    const resolved = await resolveCartForLine(parsed.odoo_session_id, lineId, parsed.partner_id)
    if (!resolved) return NextResponse.json({ error: 'LINE_NOT_FOUND' }, { status: 404 })

    await callKw(parsed.odoo_session_id, 'sale.order.line', 'write',
      [[resolved.lineId], { product_packaging_qty: packaging_qty }], {})

    const cart = await readCart(parsed.odoo_session_id, resolved.orderId)
    return NextResponse.json(cart)
  } catch (err) {
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
    const { callKw } = await import('@/lib/odoo/client')
    const { readCart } = await import('@/lib/odoo/odoo-helpers')

    const lineId = Number(params.lineId)
    const resolved = await resolveCartForLine(parsed.odoo_session_id, lineId, parsed.partner_id)
    if (!resolved) return NextResponse.json({ error: 'LINE_NOT_FOUND' }, { status: 404 })

    await callKw(parsed.odoo_session_id, 'sale.order.line', 'unlink', [[resolved.lineId]], {})

    const cart = await readCart(parsed.odoo_session_id, resolved.orderId)
    return NextResponse.json(cart)
  } catch (err) {
    console.error('cart line DELETE error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
