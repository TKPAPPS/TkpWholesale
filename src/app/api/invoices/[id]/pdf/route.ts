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

  try {
    const sessionId = await getOdooSession()
    const { callKw } = await import('@/lib/odoo/client')

    // Verify ownership
    const moves = await callKw(sessionId, 'account.move', 'read', [[id]], {
      fields: ['id', 'commercial_partner_id', 'state', 'move_type'],
    }) as { id: number; commercial_partner_id: [number, string] | false; state: string; move_type: string }[]

    const move = moves[0]
    if (!move || move.move_type !== 'out_invoice' || move.state !== 'posted') {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }
    const ownerId = move.commercial_partner_id ? move.commercial_partner_id[0] : null
    if (ownerId !== parsed.commercial_partner_id) {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    // Render PDF via JSON-RPC using the admin API key.
    // The /report/pdf/ HTTP endpoint requires auth='user' (session cookie) which
    // doesn't work with API keys on Odoo SaaS. JSON-RPC execute_kw works instead.
    // Odoo encodes returned bytes as latin-1 strings in JSON; Buffer 'binary' reverses that.
    const result = await callKw(
      sessionId,
      'ir.actions.report',
      'render_qweb_pdf',
      ['account.report_invoice_with_payments', [id]],
      {},
    ) as [string, string]

    const pdfBuffer = Buffer.from(result[0], 'binary')

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('invoice PDF error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not generate PDF.' }, { status: 503 })
  }
}
