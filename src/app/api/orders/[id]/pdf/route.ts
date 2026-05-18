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
    const { callKw } = await import('@/lib/odoo/client')

    // Verify ownership + get access_token in one read
    const orders = await callKw(sessionId, 'sale.order', 'read', [[id]], {
      fields: ['id', 'state', 'commercial_partner_id', 'partner_id', 'access_token'],
    }) as { id: number; state: string; commercial_partner_id: [number, string] | false; partner_id: [number, string] | false; access_token: string }[]

    const order = orders[0]
    if (!order || !['sale', 'done'].includes(order.state)) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }
    const partnerId = order.commercial_partner_id ? order.commercial_partner_id[0] : order.partner_id ? order.partner_id[0] : null
    if (partnerId !== parsed.commercial_partner_id) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    // Use access_token for unauthenticated portal PDF (works on Odoo SaaS).
    // Falls back to Bearer token if access_token is not available.
    const pdfUrl = order.access_token
      ? `${ODOO_URL}/report/pdf/sale.report_saleorder/${id}?access_token=${order.access_token}`
      : `${ODOO_URL}/report/pdf/sale.report_saleorder/${id}`
    const fetchHeaders: Record<string, string> = order.access_token
      ? {}
      : { Authorization: `Bearer ${sessionId.split(':').slice(1).join(':')}` }

    const pdfRes = await fetch(pdfUrl, { headers: fetchHeaders })
    const contentType = pdfRes.headers.get('content-type') ?? ''

    if (!pdfRes.ok || !contentType.includes('pdf')) {
      console.error('PDF proxy: unexpected response', pdfRes.status, contentType)
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
