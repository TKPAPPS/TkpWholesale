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
    const orders = await callKw(sessionId, 'sale.order', 'read', [[id]], {
      fields: ['id', 'state', 'commercial_partner_id', 'partner_id'],
    }) as { id: number; state: string; commercial_partner_id: [number, string] | false; partner_id: [number, string] | false }[]

    const order = orders[0]
    if (!order || !['sale', 'done'].includes(order.state)) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }
    const partnerId = order.commercial_partner_id ? order.commercial_partner_id[0] : order.partner_id ? order.partner_id[0] : null
    if (partnerId !== parsed.commercial_partner_id) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    // Render PDF via JSON-RPC using the admin API key.
    // The /report/pdf/ HTTP endpoint requires auth='user' (session cookie) which
    // doesn't work with API keys on Odoo SaaS. JSON-RPC execute_kw works instead.
    // Odoo encodes returned bytes as latin-1 strings in JSON; Buffer 'binary' reverses that.
    const result = await callKw(
      sessionId,
      'ir.actions.report',
      'render_qweb_pdf',
      ['sale.report_saleorder', [id]],
      {},
    ) as [string, string]

    const pdfBuffer = Buffer.from(result[0], 'binary')

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="order-${id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('order PDF error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not generate PDF.' }, { status: 503 })
  }
}
