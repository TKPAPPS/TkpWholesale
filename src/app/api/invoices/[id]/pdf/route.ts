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

    // Verify ownership before proxying
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

    const apikey = sessionId.split(':').slice(1).join(':')
    const pdfRes = await fetch(`${ODOO_URL}/report/pdf/account.report_invoice_with_payments/${id}`, {
      headers: { Authorization: `Bearer ${apikey}` },
    })

    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'PDF_ERROR', message: 'Could not generate PDF.' }, { status: 502 })
    }

    const pdfBuffer = await pdfRes.arrayBuffer()
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
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
