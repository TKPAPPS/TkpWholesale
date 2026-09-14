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
  // Same guard as the invoice-detail route: never pass NaN/negative ids into Odoo.
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
  }

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead, COMPANY_ID } = await import('@/lib/odoo/client')

    // Verify ownership AND company. Without the company check this endpoint would serve the
    // rendered PDF of a sibling company's invoice (on their letterhead) to any customer who
    // is also billed by that company - a worse exposure than the list, since it is the
    // document itself. Both PDF strategies below key off this already-approved id.
    // search_read, NOT read: reading a sibling company's move raises AccessError under the
    // global company scope, which would become a misleading 503. This yields [] -> clean 404.
    const moves = await searchRead(sessionId, 'account.move',
      [['id', '=', id], ['company_id', '=', COMPANY_ID]],
      ['id', 'commercial_partner_id', 'state', 'move_type', 'company_id', 'invoice_pdf_report_id'],
    ) as unknown as { id: number; commercial_partner_id: [number, string] | false; state: string; move_type: string; company_id: [number, string] | false; invoice_pdf_report_id: [number, string] | false }[]

    const move = moves[0]
    if (!move || move.move_type !== 'out_invoice' || move.state !== 'posted') {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }
    const ownerId = move.commercial_partner_id ? move.commercial_partner_id[0] : null
    const moveCompanyId = move.company_id ? move.company_id[0] : null
    if (ownerId !== parsed.commercial_partner_id || moveCompanyId !== COMPANY_ID) {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    // Where Odoo 17/18 keeps the invoice PDF: `invoice_pdf_report_id`, an attachment bound to
    // the field `invoice_pdf_report_file`. A generic ir.attachment search on res_model/res_id
    // CANNOT see it - Odoo silently appends `res_field = False` to any attachment domain that
    // does not mention res_field, so that query only ever found the older chatter copies left
    // behind by "Send by email". An invoice that had been posted but never emailed therefore
    // had no readable PDF at all, and the old fallback below it, `render_qweb_pdf`, has been
    // private (`_render_qweb_pdf`) since Odoo 17 - "The method does not exist" over RPC. So
    // INV/2026/05870 answered 503 to the customer. Found 2026-09-14.
    //
    // Order of preference: the field attachment, then a chatter copy, then GENERATE it the
    // way the Print button does (account.move.send.wizard, sending_methods=['manual'] - no
    // email is sent) and read the field attachment that produces. Generating writes the PDF
    // onto the invoice in Odoo, which is exactly what a staff member printing it would do,
    // and means the next request is a plain read.
    const readAttachment = async (attId: number): Promise<Buffer | null> => {
      const rows = await callKw(sessionId, 'ir.attachment', 'read', [[attId]], { fields: ['datas'] }) as { datas: string | false }[]
      const datas = rows[0]?.datas
      if (!datas) return null
      const buf = Buffer.from(datas, 'base64')
      return buf[0] === 0x25 && buf[1] === 0x50 ? buf : null // %P
    }

    let pdf: Buffer | null = null

    // 1. The field attachment Odoo itself maintains.
    if (move.invoice_pdf_report_id) pdf = await readAttachment(move.invoice_pdf_report_id[0])

    // 2. A chatter copy (invoices emailed before Odoo 17 keep theirs here).
    if (!pdf) {
      const chatter = await searchRead(sessionId, 'ir.attachment', [
        ['res_model', '=', 'account.move'], ['res_id', '=', id], ['mimetype', '=', 'application/pdf'],
      ], ['id'], { limit: 1, order: 'write_date desc' }) as unknown as { id: number }[]
      if (chatter[0]) pdf = await readAttachment(chatter[0].id)
    }

    // 3. Never printed or sent: have Odoo generate it, then read the field attachment.
    if (!pdf) {
      const wizardId = await callKw(sessionId, 'account.move.send.wizard', 'create',
        [{ move_id: id, sending_methods: ['manual'] }], {}) as number
      await callKw(sessionId, 'account.move.send.wizard', 'action_send_and_print', [[wizardId]], {})
      const fresh = await callKw(sessionId, 'account.move', 'read', [[id]], { fields: ['invoice_pdf_report_id'] }) as { invoice_pdf_report_id: [number, string] | false }[]
      const attId = fresh[0]?.invoice_pdf_report_id
      if (attId) pdf = await readAttachment(attId[0])
    }

    if (!pdf) throw new Error('No invoice PDF could be read or generated')
    return buildPdfResponse(pdf, `invoice-${id}.pdf`)
  } catch (err) {
    invalidateOdooSession()
    console.error('invoice PDF error:', err)
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
