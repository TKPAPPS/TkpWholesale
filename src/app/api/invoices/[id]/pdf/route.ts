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
    const { callKw, searchRead } = await import('@/lib/odoo/client')

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

    // Strategy 1: read existing ir.attachment (Odoo always stores invoice PDFs here
    // when an invoice is posted/sent; datas is base64 in JSON-RPC → reliable).
    const attachments = await searchRead(sessionId, 'ir.attachment', [
      ['res_model', '=', 'account.move'],
      ['res_id', '=', id],
      ['mimetype', '=', 'application/pdf'],
    ], ['id', 'datas', 'name'], { limit: 1, order: 'write_date desc' })

    if (attachments.length > 0 && attachments[0].datas) {
      const buf = Buffer.from(attachments[0].datas as string, 'base64')
      if (buf[0] === 0x25) { // starts with '%' → valid PDF
        return buildPdfResponse(buf, `invoice-${id}.pdf`)
      }
    }

    // Strategy 2: render via JSON-RPC execute_kw (bypasses HTTP auth).
    // Odoo may encode returned bytes as base64 or latin-1; detect by PDF magic bytes.
    const result = await callKw(
      sessionId,
      'ir.actions.report',
      'render_qweb_pdf',
      ['account.report_invoice_with_payments', [id]],
      {},
    ) as [string, string]

    const pdfBuffer = decodePdf(result[0])
    if (!pdfBuffer) throw new Error('render_qweb_pdf returned unreadable data')

    return buildPdfResponse(pdfBuffer, `invoice-${id}.pdf`)
  } catch (err) {
    invalidateOdooSession()
    console.error('invoice PDF error:', err)
    return NextResponse.json({ error: 'PDF_ERROR', message: 'Could not generate PDF.' }, { status: 503 })
  }
}

function decodePdf(data: string): Buffer | null {
  const b64 = Buffer.from(data, 'base64')
  if (b64[0] === 0x25 && b64[1] === 0x50) return b64 // %P
  const bin = Buffer.from(data, 'binary')
  if (bin[0] === 0x25 && bin[1] === 0x50) return bin
  return null
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
