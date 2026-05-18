import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'
const ODOO_URL = process.env.ODOO_URL!

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
    const { assertOrderOwnership } = await import('@/lib/odoo/odoo-helpers')

    try {
      const order = await assertOrderOwnership(sessionId, id, parsed.commercial_partner_id)
      if (!['sale', 'done'].includes(order.state)) {
        return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
      }
    } catch {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    // Proxy the PDF from Odoo using the admin server-side session
    const pdfRes = await fetch(`${ODOO_URL}/report/pdf/sale.report_saleorder/${id}`, {
      method: 'GET',
      headers: {
        Cookie: `session_id=${sessionId}`,
      },
    })

    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'PDF_ERROR', message: 'Could not generate PDF.' }, { status: 502 })
    }

    const pdfBuffer = await pdfRes.arrayBuffer()

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
    console.error('PDF proxy error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
