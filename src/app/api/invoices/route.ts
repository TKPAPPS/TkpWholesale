import { NextRequest, NextResponse } from 'next/server'
import { MOCK_INVOICES } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

function computeStateLabel(paymentState: string, dueDateStr: string | null): string {
  if (paymentState === 'paid') return 'Paid'
  if (paymentState === 'in_payment') return 'In Payment'
  if (paymentState === 'partial') return 'Partial'
  if (dueDateStr && new Date(dueDateStr) < new Date()) return 'Overdue'
  return 'Due'
}

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const rawPage = Number(searchParams.get('page'))
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 0
  const filter = searchParams.get('filter') ?? 'all' // all | unpaid | paid

  if (USE_MOCK) {
    const PER_PAGE = DEFAULT_SITE_SETTINGS.invoicesPerPage
    let invoices = [...MOCK_INVOICES]
    if (filter === 'unpaid') invoices = invoices.filter((i) => i.payment_state !== 'paid')
    if (filter === 'paid') invoices = invoices.filter((i) => i.payment_state === 'paid')
    const total = invoices.length
    const paged = invoices.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
    const totalOutstanding = invoices.reduce((s, i) => s + i.amount_residual, 0)
    return NextResponse.json({ invoices: paged, total, total_outstanding: totalOutstanding, currency: 'THB' })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead } = await import('@/lib/odoo/client')
    const { getSiteSettings } = await import('@/lib/odoo/odoo-helpers')
    const PER_PAGE = (await getSiteSettings()).invoicesPerPage

    const baseDomain: unknown[] = [
      ['move_type', '=', 'out_invoice'],
      ['commercial_partner_id', '=', parsed.commercial_partner_id],
      ['state', '=', 'posted'],
    ]
    if (filter === 'unpaid') baseDomain.push(['payment_state', 'not in', ['paid', 'in_payment']])
    if (filter === 'paid') baseDomain.push(['payment_state', '=', 'paid'])

    const FIELDS = ['id', 'name', 'invoice_date', 'invoice_date_due',
      'amount_total', 'amount_residual', 'payment_state', 'currency_id',
      'invoice_line_ids']

    // outstandingDomain intentionally omits the filter param — outstanding balance
    // is always across all posted invoices regardless of the current page filter.
    const outstandingDomain: unknown[] = [
      ['move_type', '=', 'out_invoice'],
      ['commercial_partner_id', '=', parsed.commercial_partner_id],
      ['state', '=', 'posted'],
    ]

    const [total, rows, outstandingGroups] = await Promise.all([
      callKw(sessionId, 'account.move', 'search_count', [baseDomain], {}) as Promise<number>,
      searchRead(sessionId, 'account.move', baseDomain, FIELDS, {
        order: 'invoice_date desc', limit: PER_PAGE, offset: page * PER_PAGE,
      }) as Promise<{
        id: number; name: string; invoice_date: string; invoice_date_due: string | false;
        amount_total: number; amount_residual: number; payment_state: string;
        currency_id: [number, string]; invoice_line_ids: number[]
      }[]>,
      // read_group returns one aggregated row — avoids fetching up to 500 records just for a SUM
      callKw(sessionId, 'account.move', 'read_group',
        [outstandingDomain, ['amount_residual:sum'], []],
        { lazy: false },
      ) as Promise<{ amount_residual: number }[]>,
    ])

    const totalOutstanding = outstandingGroups[0]?.amount_residual ?? 0
    const currency = rows[0]?.currency_id[1] ?? 'THB'

    const invoices = rows.map((r) => ({
      id: r.id,
      name: r.name,
      invoice_date: r.invoice_date,
      invoice_date_due: r.invoice_date_due || null,
      amount_total: r.amount_total,
      amount_residual: r.amount_residual,
      payment_state: r.payment_state as 'not_paid' | 'partial' | 'in_payment' | 'paid',
      currency: r.currency_id[1] ?? 'THB',
      state_label: computeStateLabel(r.payment_state, r.invoice_date_due || null),
      line_count: r.invoice_line_ids.length,
    }))

    return NextResponse.json({ invoices, total, total_outstanding: totalOutstanding, currency }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('invoices list error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
