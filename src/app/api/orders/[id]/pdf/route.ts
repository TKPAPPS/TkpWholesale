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
  // Same guard as the order-detail route: never pass NaN/negative ids into Odoo.
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  }

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead } = await import('@/lib/odoo/client')
    const { assertOrderOwnership } = await import('@/lib/odoo/odoo-helpers')

    // Verify ownership (sale.order has no commercial_partner_id field - assertOrderOwnership
    // validates via a partner_id child_of hierarchy search).
    let order: Awaited<ReturnType<typeof assertOrderOwnership>>
    try {
      order = await assertOrderOwnership(sessionId, id, parsed.commercial_partner_id)
    } catch {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }
    if (!['sale', 'done'].includes(order.state)) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    // Strategy 1: read existing ir.attachment (Odoo stores generated PDFs here;
    // datas is a Binary field → always base64 in JSON-RPC, reliable decoding).
    const attachments = await searchRead(sessionId, 'ir.attachment', [
      ['res_model', '=', 'sale.order'],
      ['res_id', '=', id],
      ['mimetype', '=', 'application/pdf'],
    ], ['id', 'datas', 'name'], { limit: 1, order: 'write_date desc' })

    if (attachments.length > 0 && attachments[0].datas) {
      const buf = Buffer.from(attachments[0].datas as string, 'base64')
      if (buf[0] === 0x25) { // starts with '%' → valid PDF
        return buildPdfResponse(buf, `order-${id}.pdf`)
      }
    }

    // Strategy 2: render via JSON-RPC execute_kw (bypasses HTTP auth).
    // Odoo may encode returned bytes as base64 or latin-1; detect by PDF magic bytes.
    // No stored attachment, and there is no way to render one from here. Odoo 17+ removed the
    // public ir.actions.report.render_qweb_pdf, and the replacement _render_qweb_pdf is private,
    // so JSON-RPC cannot reach either ("Private methods cannot be called"). Sales orders also do
    // not get a PDF stored on posting the way invoices do: sampled 25 recent orders, 0 had an
    // attachment, against 25 of 25 invoices. So this endpoint can only ever serve an order whose
    // PDF someone has already generated in Odoo.
    //
    // Answer 404, not 503. The old code called the dead method and reported "Could not generate
    // PDF, please try again", which described a transient outage and invited the customer to
    // retry something that could never succeed. The portal offers Print instead, which produces
    // a PDF from the on-screen document and carries the delivered quantities that Odoo's own
    // sales order PDF does not.
    return NextResponse.json(
      { error: 'PDF_NOT_AVAILABLE', message: 'No PDF is stored for this order. Use Print to save a copy.' },
      { status: 404 },
    )
  } catch (err) {
    invalidateOdooSession()
    console.error('order PDF error:', err)
    return NextResponse.json({ error: 'PDF_ERROR', message: 'Could not generate PDF.' }, { status: 503 })
  }
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
