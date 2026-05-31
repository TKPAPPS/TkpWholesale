import { NextRequest, NextResponse } from 'next/server'
import { MOCK_INVOICE_DETAIL } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

function computeStateLabel(paymentState: string, dueDateStr: string | null): string {
  if (paymentState === 'paid') return 'Paid'
  if (paymentState === 'in_payment') return 'In Payment'
  if (paymentState === 'partial') return 'Partial'
  if (dueDateStr && new Date(dueDateStr) < new Date()) return 'Overdue'
  return 'Due'
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
  }

  if (USE_MOCK) {
    if (id !== 201) return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    return NextResponse.json(MOCK_INVOICE_DETAIL)
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead } = await import('@/lib/odoo/client')

    // Fetch invoice + verify ownership via commercial_partner_id
    const moves = await callKw(sessionId, 'account.move', 'read', [[id]], {
      fields: ['id', 'name', 'invoice_date', 'invoice_date_due', 'amount_total',
        'amount_residual', 'amount_untaxed', 'amount_tax', 'payment_state',
        'currency_id', 'commercial_partner_id', 'state', 'move_type', 'narration'],
    }) as {
      id: number; name: string; invoice_date: string; invoice_date_due: string | false;
      amount_total: number; amount_residual: number; amount_untaxed: number; amount_tax: number;
      payment_state: string; currency_id: [number, string]; state: string; move_type: string;
      commercial_partner_id: [number, string] | false; narration: string | false;
    }[]

    const move = moves[0]
    if (!move || move.move_type !== 'out_invoice' || move.state !== 'posted') {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    // Ownership check
    const ownerId = move.commercial_partner_id ? move.commercial_partner_id[0] : null
    if (ownerId !== parsed.commercial_partner_id) {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    // Fetch product lines
    const lines = await searchRead(sessionId, 'account.move.line',
      [['move_id', '=', id], ['display_type', 'not in', ['line_section', 'line_note']], ['product_id', '!=', false]],
      ['id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'price_total'],
    ) as { id: number; name: string; quantity: number; price_unit: number; price_subtotal: number; price_total: number }[]

    return NextResponse.json({
      id: move.id,
      name: move.name,
      invoice_date: move.invoice_date,
      invoice_date_due: move.invoice_date_due || null,
      amount_total: move.amount_total,
      amount_residual: move.amount_residual,
      amount_untaxed: move.amount_untaxed,
      amount_tax: move.amount_tax,
      payment_state: move.payment_state,
      currency: move.currency_id[1] ?? 'THB',
      state_label: computeStateLabel(move.payment_state, move.invoice_date_due || null),
      line_count: lines.length,
      note: move.narration || '',
      lines: lines.map((l) => ({
        line_id: l.id,
        name: l.name,
        quantity: l.quantity,
        price_unit: l.price_unit,
        price_subtotal: l.price_subtotal,
        price_total: l.price_total,
      })),
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('invoice detail error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
