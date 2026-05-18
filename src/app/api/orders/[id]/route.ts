import { NextRequest, NextResponse } from 'next/server'
import { MOCK_ORDER_DETAIL } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const id = Number(params.id)

  if (USE_MOCK) {
    if (id !== 789) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    return NextResponse.json(MOCK_ORDER_DETAIL)
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { assertOrderOwnership } = await import('@/lib/odoo/odoo-helpers')
    const { searchRead, callKw } = await import('@/lib/odoo/client')

    let order: Awaited<ReturnType<typeof assertOrderOwnership>>
    try {
      order = await assertOrderOwnership(sessionId, id, parsed.commercial_partner_id)
    } catch {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    if (!['sale', 'done'].includes(order.state)) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    // Fetch lines
    const lines = await searchRead(sessionId, 'sale.order.line',
      [['order_id', '=', id]],
      ['id', 'product_id', 'product_template_id', 'product_packaging_id',
        'product_packaging_qty', 'product_uom_qty', 'price_unit',
        'price_subtotal', 'price_total', 'name'],
    ) as {
      id: number; product_id: [number, string]; product_template_id: [number, string];
      product_packaging_id: [number, string] | false; product_packaging_qty: number;
      product_uom_qty: number; price_unit: number; price_subtotal: number;
      price_total: number; name: string;
    }[]

    // Fetch shipping address
    const shippingId = order.partner_shipping_id ? order.partner_shipping_id[0] : null
    let shippingAddress = { id: 0, name: '', street: '', city: '', zip: '', country: '' }
    if (shippingId) {
      const addrs = await callKw(sessionId, 'res.partner', 'read', [[shippingId]], {
        fields: ['id', 'name', 'street', 'street2', 'city', 'zip', 'country_id'],
      }) as { id: number; name: string; street: string | false; street2: string | false; city: string | false; zip: string | false; country_id: [number, string] | false }[]
      const a = addrs[0]
      if (a) {
        shippingAddress = {
          id: a.id,
          name: a.name,
          street: a.street || '',
          city: a.city || '',
          zip: a.zip || '',
          country: a.country_id ? a.country_id[1] : '',
        }
      }
    }

    const STATE_LABELS: Record<string, string> = { sale: 'Confirmed', done: 'Done' }

    return NextResponse.json({
      id: order.id,
      name: order.name,
      date_order: order.date_order,
      amount_total: order.amount_total,
      currency: order.currency_id[1] ?? 'THB',
      state: order.state,
      state_label: STATE_LABELS[order.state] ?? order.state,
      line_count: lines.length,
      partner_shipping: shippingAddress,
      note: order.note || '',
      lines: lines.map(l => ({
        line_id: l.id,
        product_id: l.product_id[0],
        product_name: l.product_template_id[1] ?? l.name,
        product_name_he: l.product_template_id[1] ?? l.name,
        sku: '',
        packaging_name: l.product_packaging_id ? l.product_packaging_id[1] : 'Unit',
        packaging_qty: l.product_packaging_qty,
        unit_qty: l.product_uom_qty,
        price_unit: l.price_unit,
        price_subtotal: l.price_subtotal,
        price_total: l.price_total,
      })),
      amount_untaxed: order.amount_untaxed,
      amount_tax: order.amount_tax,
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('order detail error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
