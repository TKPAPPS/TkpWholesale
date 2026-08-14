import { NextRequest, NextResponse } from 'next/server'
import { MOCK_ORDER_DETAIL } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { deliveryStateFromLines, DELIVERY_STATE_LABELS } from '@/lib/order-labels'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  }

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
        'price_subtotal', 'price_total', 'name',
        // Delivery reporting. qty_delivered_method is the reliable "is this a physical
        // item" signal: 'stock_move' means Odoo derives the delivered quantity from actual
        // stock moves, while 'manual' marks charge lines such as Delivery Service, which
        // never ship and would otherwise report a permanent shortfall (356 of 3,000 lines
        // in the last fortnight). Never infer this from the product type.
        'qty_delivered', 'qty_invoiced', 'qty_delivered_method', 'product_uom'],
    ) as {
      id: number; product_id: [number, string]; product_template_id: [number, string];
      product_packaging_id: [number, string] | false; product_packaging_qty: number;
      product_uom_qty: number; price_unit: number; price_subtotal: number;
      price_total: number; name: string;
      qty_delivered: number; qty_invoiced: number; qty_delivered_method: string;
      product_uom: [number, string] | false;
    }[]

    // Which of this order's units of measure are weight-based. Goods priced by weight (fish,
    // produce, "Box of 5 kg") are weighed at pick time, so delivered legitimately differs from
    // ordered. Resolved from the UoM CATEGORY rather than by matching names, which would miss
    // "Box of 5 kg" and misread anything renamed.
    const uomIds = Array.from(new Set(lines.map((l) => (l.product_uom ? l.product_uom[0] : 0)).filter(Boolean)))
    const weightUomIds = new Set<number>()
    if (uomIds.length > 0) {
      const uoms = await callKw(sessionId, 'uom.uom', 'read', [uomIds], {
        fields: ['id', 'category_id'],
      }) as { id: number; category_id: [number, string] | false }[]
      uoms.forEach((u) => { if (u.category_id && u.category_id[1] === 'Weight') weightUomIds.add(u.id) })
    }

    // Fetch SKUs from product variants
    const variantIds = lines.map((l) => l.product_id[0]).filter(Boolean)
    const variants = variantIds.length > 0
      ? await callKw(sessionId, 'product.product', 'read', [variantIds], {
          fields: ['id', 'default_code'],
        }) as { id: number; default_code: string | false }[]
      : []
    const skuMap: Record<number, string> = {}
    variants.forEach((v) => { skuMap[v.id] = v.default_code || '' })

    // Product names in BOTH languages - the admin session context is English, so
    // reading only product_template_id[1] gave Hebrew customers English names.
    // Read the template names under en_US + he_IL contexts (same pattern as
    // readOrderItemsForSchedule) and map per language.
    const templateIds = Array.from(new Set(lines.map((l) => l.product_template_id[0]).filter(Boolean)))
    const [enNames, heNames] = templateIds.length > 0
      ? await Promise.all([
          callKw(sessionId, 'product.template', 'read', [templateIds], {
            fields: ['id', 'name'], context: { lang: 'en_US' },
          }) as Promise<{ id: number; name: string }[]>,
          callKw(sessionId, 'product.template', 'read', [templateIds], {
            fields: ['id', 'name'], context: { lang: 'he_IL' },
          }) as Promise<{ id: number; name: string }[]>,
        ])
      : [[], []]
    const enNameMap: Record<number, string> = {}
    enNames.forEach((t) => { enNameMap[t.id] = t.name })
    const heNameMap: Record<number, string> = {}
    heNames.forEach((t) => { heNameMap[t.id] = t.name })

    // Fetch shipping address
    const shippingId = order.partner_shipping_id ? order.partner_shipping_id[0] : null
    let shippingAddress = { id: 0, name: '', street: '', city: '', zip: '', country: '' }
    if (shippingId) {
      const addrs = await callKw(sessionId, 'res.partner', 'read', [[shippingId]], {
        fields: ['id', 'name', 'street', 'street2', 'city', 'zip', 'country_id'],
      }, { scopeToCompany: false }) as { id: number; name: string; street: string | false; street2: string | false; city: string | false; zip: string | false; country_id: [number, string] | false }[]
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
      // Same derivation as the orders list, so an order never reads "Partly delivered" in the
      // list and "Confirmed" on its own page. Falls back to the plain state when the order has
      // no stock-tracked lines at all.
      state_label: (() => {
        const st = deliveryStateFromLines(lines.map((l) => ({
          qty_ordered: l.product_uom_qty,
          qty_delivered: l.qty_delivered,
          deliverable: l.qty_delivered_method === 'stock_move',
          weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
        })))
        if (order.state === 'cancel') return STATE_LABELS.cancel ?? order.state
        return st === 'unknown' ? (STATE_LABELS[order.state] ?? order.state) : DELIVERY_STATE_LABELS[st]
      })(),
      delivery_state: deliveryStateFromLines(lines.map((l) => ({
        qty_ordered: l.product_uom_qty,
        qty_delivered: l.qty_delivered,
        deliverable: l.qty_delivered_method === 'stock_move',
        weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
      }))),
      line_count: lines.length,
      partner_shipping: shippingAddress,
      note: order.note || '',
      client_order_ref: order.client_order_ref || '',
      commitment_date: order.commitment_date || '',
      lines: lines.map(l => ({
        line_id: l.id,
        product_id: l.product_id[0],
        template_id: l.product_template_id[0],
        packaging_id: l.product_packaging_id ? l.product_packaging_id[0] : null,
        product_name: enNameMap[l.product_template_id[0]] ?? l.product_template_id[1] ?? l.name,
        product_name_he: heNameMap[l.product_template_id[0]] ?? enNameMap[l.product_template_id[0]] ?? l.product_template_id[1] ?? l.name,
        sku: skuMap[l.product_id[0]] ?? '',
        packaging_name: l.product_packaging_id ? l.product_packaging_id[1] : 'Unit',
        packaging_qty: l.product_packaging_qty,
        unit_qty: l.product_uom_qty,
        uom: l.product_uom ? l.product_uom[1] : '',
        qty_delivered: l.qty_delivered,
        qty_invoiced: l.qty_invoiced,
        // Only stock-tracked lines take part in the ordered-vs-delivered comparison.
        deliverable: l.qty_delivered_method === 'stock_move',
        // Weight-priced goods (fish, produce sold by kg) are weighed at pick time, so the
        // delivered quantity legitimately differs from what was ordered. Flagging those as
        // short would bury the real shortfalls in noise.
        weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
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
