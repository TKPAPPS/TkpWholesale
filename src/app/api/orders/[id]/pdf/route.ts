import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json({ error: 'PDF_NOT_AVAILABLE', message: 'PDF download requires real Odoo connection.' }, { status: 503 })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const id = Number(params.id)
  // Same guard as the order-detail route: never pass NaN/negative ids into Odoo.
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  }

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead, COMPANY_ID } = await import('@/lib/odoo/client')
    const { assertOrderOwnership } = await import('@/lib/odoo/odoo-helpers')

    // Verify ownership (sale.order has no commercial_partner_id field - assertOrderOwnership
    // validates via a partner_id child_of hierarchy search).
    let order: Awaited<ReturnType<typeof assertOrderOwnership>>
    try {
      order = await assertOrderOwnership(sessionId, id, parsed.commercial_partner_id)
    } catch {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }
    if (!['sale', 'done'].includes(order.state)) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    // We generate this document ourselves rather than asking Odoo for it. Odoo 17+ removed the
    // public ir.actions.report.render_qweb_pdf and the private replacement is unreachable over
    // RPC; sales orders carry no stored PDF the way invoices do (0 of 25 recent orders, against
    // 25 of 25 invoices); and this SaaS instance refuses an API key for the web session that
    // /report/pdf would require. Generating it here also lets the document show ordered against
    // delivered, which Odoo's own sales order report does not carry.
    const [lines, uoms, shipRows, company] = await (async () => {
      const rawLines = await searchRead(sessionId, 'sale.order.line',
        [['order_id', '=', id], ['display_type', '=', false]],
        ['product_id', 'name', 'product_uom_qty', 'qty_delivered', 'qty_invoiced',
          'qty_delivered_method', 'product_uom', 'product_packaging_id', 'product_packaging_qty',
          'price_total'],
        { order: 'sequence, id', limit: 0 },
      ) as unknown as {
        product_id: [number, string] | false; name: string; product_uom_qty: number
        qty_delivered: number; qty_invoiced: number; qty_delivered_method: string
        product_uom: [number, string] | false; product_packaging_id: [number, string] | false
        product_packaging_qty: number; price_total: number
      }[]

      const uomIds = Array.from(new Set(rawLines.map((l) => (l.product_uom ? l.product_uom[0] : 0)).filter(Boolean)))
      const uomRows = uomIds.length
        ? await callKw(sessionId, 'uom.uom', 'read', [uomIds], { fields: ['id', 'category_id'] }) as
          { id: number; category_id: [number, string] | false }[]
        : []

      const shipId = order.partner_shipping_id ? order.partner_shipping_id[0] : null
      const ship = shipId
        ? await callKw(sessionId, 'res.partner', 'read', [[shipId]],
            { fields: ['name', 'street', 'city', 'country_id'] },
            { scopeToCompany: false }) as { name: string; street: string | false; city: string | false; country_id: [number, string] | false }[]
        : []

      const { getCompanyDetails } = await import('@/lib/odoo/odoo-helpers')
      const co = await getCompanyDetails(COMPANY_ID)
      return [rawLines, uomRows, ship, co] as const
    })()

    const weightUomIds = new Set<number>()
    uoms.forEach((u) => { if (u.category_id && u.category_id[1] === 'Weight') weightUomIds.add(u.id) })

    // SKUs, batched
    const variantIds = Array.from(new Set(lines.map((l) => (l.product_id ? l.product_id[0] : 0)).filter(Boolean)))
    const skuMap: Record<number, string> = {}
    if (variantIds.length > 0) {
      const variants = await callKw(sessionId, 'product.product', 'read', [variantIds], { fields: ['id', 'default_code'] }) as
        { id: number; default_code: string | false }[]
      variants.forEach((v) => { skuMap[v.id] = v.default_code || '' })
    }

    // Same derivation the page and the orders list use, so the PDF cannot state a different
    // delivery status from the screen the customer downloaded it from.
    const { deliveryStateFromLines, DELIVERY_STATE_LABELS } = await import('@/lib/order-labels')
    const deliveryState = deliveryStateFromLines(lines.map((l) => ({
      qty_ordered: l.product_uom_qty,
      qty_delivered: l.qty_delivered,
      deliverable: l.qty_delivered_method === 'stock_move',
      weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
    })))
    const deliveryLabel = deliveryState === 'unknown' ? 'Confirmed' : DELIVERY_STATE_LABELS[deliveryState]

    const ship = shipRows[0]
    const { buildOrderPdf } = await import('@/lib/order-pdf')
    const bytes = await buildOrderPdf({
      name: order.name,
      date_order: order.date_order,
      commitment_date: order.commitment_date || null,
      client_order_ref: order.client_order_ref || null,
      state_label: deliveryLabel,
      currency: order.currency_id ? order.currency_id[1] : 'THB',
      note: order.note || null,
      ship_to: {
        name: ship ? ship.name : '',
        street: ship && ship.street ? ship.street : '',
        city: ship && ship.city ? ship.city : '',
        country: ship && ship.country_id ? ship.country_id[1] : '',
      },
      company: {
        name: company?.name ?? '',
        street: company?.street ?? '',
        city: company?.city ?? '',
        country: company?.country ?? '',
        vat: company?.vat ?? '',
        phone: company?.phone ?? '',
      },
      lines: lines.map((l) => ({
        product_name: l.product_id ? l.product_id[1] : l.name,
        sku: l.product_id ? (skuMap[l.product_id[0]] ?? '') : '',
        packaging_name: l.product_packaging_id ? l.product_packaging_id[1] : '',
        packaging_qty: l.product_packaging_qty,
        unit_qty: l.product_uom_qty,
        uom: l.product_uom ? l.product_uom[1] : '',
        qty_delivered: l.qty_delivered,
        qty_invoiced: l.qty_invoiced,
        deliverable: l.qty_delivered_method === 'stock_move',
        weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
        price_total: l.price_total,
      })),
      amount_untaxed: order.amount_untaxed,
      amount_tax: order.amount_tax,
      amount_total: order.amount_total,
    })

    return buildPdfResponse(Buffer.from(bytes), `${order.name || `order-${id}`}.pdf`)
  } catch (err) {
    invalidateOdooSession()
    console.error('order PDF error:', err)
    return NextResponse.json({ error: 'PDF_ERROR', message: 'Could not generate PDF.' }, { status: 503 })
  }
}

function buildPdfResponse(buf: Buffer, filename: string) {
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
