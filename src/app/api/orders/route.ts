import { NextRequest, NextResponse } from 'next/server'
import { MOCK_ORDERS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.toLowerCase() ?? ''
  const page = Number(searchParams.get('page') ?? 0)
  const perPage = Number(searchParams.get('per_page') ?? 20)
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')

  if (USE_MOCK) {
    let orders = MOCK_ORDERS
    if (search) orders = orders.filter((o) => o.name.toLowerCase().includes(search))
    const total = orders.length
    return NextResponse.json({ orders: orders.slice(page * perPage, page * perPage + perPage), total, page, per_page: perPage })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { searchRead } = await import('@/lib/odoo/client')

    const domain: unknown[] = [
      // child_of finds the partner + all child contacts in the company hierarchy
      ['partner_id', 'child_of', parsed.commercial_partner_id],
      ['state', 'in', ['sale', 'done']],
    ]
    if (search) domain.push(['name', 'ilike', search])
    if (dateFrom) domain.push(['date_order', '>=', dateFrom])
    if (dateTo) domain.push(['date_order', '<=', dateTo + ' 23:59:59'])

    const { callKw } = await import('@/lib/odoo/client')

    const FIELDS = ['id', 'name', 'date_order', 'amount_total', 'currency_id', 'state', 'order_line', 'delivery_status']

    // Count + page in parallel — avoids fetching all orders just to slice
    const [total, rawOrders] = await Promise.all([
      callKw(sessionId, 'sale.order', 'search_count', [domain], {}) as Promise<number>,
      searchRead(sessionId, 'sale.order', domain, FIELDS, {
        order: 'date_order desc', limit: perPage, offset: page * perPage,
      }) as Promise<{ id: number; name: string; date_order: string; amount_total: number; currency_id: [number, string]; state: string; order_line: number[]; delivery_status?: string }[]>,
    ])

    const STATE_LABELS: Record<string, string> = {
      draft: 'Quotation', sent: 'Sent', sale: 'Confirmed', done: 'Completed', cancel: 'Cancelled',
    }
    const DELIVERY_LABELS: Record<string, string> = {
      pending: 'Confirmed', partial: 'Partially Shipped', full: 'Delivered',
    }

    const orders = rawOrders.map(o => {
      const deliveryStatus = o.delivery_status ?? null
      const stateLabel = deliveryStatus
        ? DELIVERY_LABELS[deliveryStatus] ?? STATE_LABELS[o.state] ?? o.state
        : STATE_LABELS[o.state] ?? o.state
      return {
        id: o.id,
        name: o.name,
        date_order: o.date_order,
        amount_total: o.amount_total,
        currency: o.currency_id[1] ?? 'THB',
        state: o.state,
        delivery_status: deliveryStatus,
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
