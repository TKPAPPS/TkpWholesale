import { NextRequest, NextResponse } from 'next/server'
import { MOCK_ORDERS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { parsePagination, isIsoDate } from '@/lib/pagination'
import { orderStateLabel, deliveryStateFromLines, DELIVERY_STATE_LABELS, type DeliveryLine } from '@/lib/order-labels'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.toLowerCase() ?? ''
  const { page, perPage, offset } = parsePagination(searchParams, 20)
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  for (const [name, value] of [['date_from', dateFrom], ['date_to', dateTo]] as const) {
    if (value !== null && value !== '' && !isIsoDate(value)) {
      return NextResponse.json({ error: 'INVALID_DATE', message: `${name} must be YYYY-MM-DD.` }, { status: 400 })
    }
  }

  if (USE_MOCK) {
    let orders = MOCK_ORDERS
    if (search) orders = orders.filter((o) => o.name.toLowerCase().includes(search))
    const total = orders.length
    return NextResponse.json({ orders: orders.slice(offset, offset + perPage), total, page, per_page: perPage })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { searchRead, COMPANY_ID } = await import('@/lib/odoo/client')

    const domain: unknown[] = [
      // child_of finds the partner + all child contacts in the company hierarchy
      ['partner_id', 'child_of', parsed.commercial_partner_id],
      // ...but only this company's orders: the same customer also buys from sibling
      // companies, and those orders are not this portal's business.
      ['company_id', '=', COMPANY_ID],
      ['state', 'in', ['sale', 'done']],
    ]
    if (search) domain.push(['name', 'ilike', search])
    if (dateFrom) domain.push(['date_order', '>=', dateFrom])
    if (dateTo) domain.push(['date_order', '<=', dateTo + ' 23:59:59'])

    const { callKw } = await import('@/lib/odoo/client')

    const FIELDS = ['id', 'name', 'date_order', 'amount_total', 'currency_id', 'state', 'order_line', 'delivery_status']

    // Count + page in parallel - avoids fetching all orders just to slice
    const [total, rawOrders] = await Promise.all([
      callKw(sessionId, 'sale.order', 'search_count', [domain], {}) as Promise<number>,
      searchRead(sessionId, 'sale.order', domain, FIELDS, {
        order: 'date_order desc', limit: perPage, offset,
      }) as Promise<{ id: number; name: string; date_order: string; amount_total: number; currency_id: [number, string]; state: string; order_line: number[]; delivery_status?: string }[]>,
    ])

    // Derive the delivery badge from the LINES, not from Odoo's delivery_status, which reports
    // "full" as soon as nothing is outstanding and therefore counts a CANCELLED line as
    // satisfied. That is how S17189 came to be badged "Delivered" with two of its fourteen
    // lines never shipped. One batched read covers the whole page (~20 orders), and it fails
    // soft: if it errors we fall back to the old label rather than break the order list.
    const lineIds = rawOrders.flatMap(o => o.order_line)
    const linesByOrder = new Map<number, DeliveryLine[]>()
    if (lineIds.length > 0) {
      try {
        const rawLines = await searchRead(sessionId, 'sale.order.line',
          [['id', 'in', lineIds]],
          ['id', 'order_id', 'product_uom_qty', 'qty_delivered', 'qty_delivered_method', 'product_uom'],
          { limit: 0 },
        ) as unknown as { order_id: [number, string]; product_uom_qty: number; qty_delivered: number
          qty_delivered_method: string; product_uom: [number, string] | false }[]
        const uomIds = Array.from(new Set(rawLines.map(l => (l.product_uom ? l.product_uom[0] : 0)).filter(Boolean)))
        const weightUomIds = new Set<number>()
        if (uomIds.length > 0) {
          const uoms = await callKw(sessionId, 'uom.uom', 'read', [uomIds], { fields: ['id', 'category_id'] }) as
            { id: number; category_id: [number, string] | false }[]
          uoms.forEach(u => { if (u.category_id && u.category_id[1] === 'Weight') weightUomIds.add(u.id) })
        }
        rawLines.forEach(l => {
          const oid = l.order_id[0]
          const arr = linesByOrder.get(oid) ?? []
          arr.push({
            qty_ordered: l.product_uom_qty,
            qty_delivered: l.qty_delivered,
            deliverable: l.qty_delivered_method === 'stock_move',
            weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
          })
          linesByOrder.set(oid, arr)
        })
      } catch (err) {
        console.error('delivery state lookup failed, falling back to delivery_status:', err)
      }
    }

    const orders = rawOrders.map(o => {
      const deliveryStatus = o.delivery_status ?? null
      const derived = linesByOrder.get(o.id)
      const deliveryState = derived ? deliveryStateFromLines(derived) : 'unknown'
      const stateLabel = derived && deliveryState !== 'unknown'
        ? DELIVERY_STATE_LABELS[deliveryState]
        : orderStateLabel(o.state, deliveryStatus)
      return {
        id: o.id,
        name: o.name,
        date_order: o.date_order,
        amount_total: o.amount_total,
        currency: o.currency_id[1] ?? 'THB',
        state: o.state,
        delivery_status: deliveryStatus,
        delivery_state: deliveryState,
        state_label: stateLabel,
        line_count: o.order_line.length,
      }
    })

    return NextResponse.json({ orders, total, page, per_page: perPage }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('orders error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
