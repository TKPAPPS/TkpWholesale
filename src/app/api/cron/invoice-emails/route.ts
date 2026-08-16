import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { buildOrderPdf, type OrderPdfLine } from '@/lib/order-pdf'
import { renderInvoiceEmail } from '@/lib/invoice-email'

export const maxDuration = 60

// Emails the customer when an invoice is posted in Odoo, attaching the order document (what was
// ordered against what was delivered) and Odoo's own invoice PDF.
//
// Polls rather than waiting for an Odoo automation: ~48 invoices a day is trivial to scan, and it
// needs no Odoo-side configuration, which is where the equivalent automation work is parked.
//
// THREE SAFETY RAILS, all deliberate:
//   1. START_DATE. There are 4,551 posted invoices in the database. Without a floor the first run
//      would email the entire history. Nothing before this date is ever considered.
//   2. The invoice_emails table, unique on odoo_invoice_id. An invoice is recorded the moment it
//      is handled, so an overlapping or re-triggered run cannot send twice.
//   3. MAX_PER_RUN. A backstop against a bad query turning into a mass mailing.
//
// Modes:
//   ?dry=1          list what would be sent, send nothing, write nothing
//   ?test=<email>   render the single most recent eligible invoice and send it to that address
//                   only, without recording it, so the real customer never receives the sample

const START_DATE = process.env.INVOICE_EMAIL_START_DATE ?? '2026-08-16'
const MAX_PER_RUN = 40

function unauthorized() {
  return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  // Its own secret, not the shared CRON_SECRET. The scheduled-orders job already runs on that
  // one from an external scheduler, so rotating or reusing it to test this endpoint risks
  // breaking a job that is working. Falls back to CRON_SECRET only if the dedicated one is unset.
  const secret = process.env.INVOICE_CRON_SECRET || process.env.CRON_SECRET
  const given = req.nextUrl.searchParams.get('secret')
    ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!secret || given !== secret) return unauthorized()

  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const testTo = req.nextUrl.searchParams.get('test')

  try {
    const { getOdooSession } = await import('@/lib/odoo/admin-session')
    const { callKw, searchRead, COMPANY_ID } = await import('@/lib/odoo/client')
    const { getCompanyDetails } = await import('@/lib/odoo/odoo-helpers')
    const sessionId = await getOdooSession()

    // Posted customer invoices from the cutoff onward. Refunds are excluded: a credit note is a
    // different conversation and should not arrive dressed as a delivery confirmation.
    const invoices = await searchRead(sessionId, 'account.move',
      [
        ['company_id', '=', COMPANY_ID],
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', START_DATE],
      ],
      ['id', 'name', 'invoice_date', 'invoice_origin', 'partner_id', 'amount_total', 'currency_id'],
      { order: 'id desc', limit: 200 },
    ) as unknown as {
      id: number; name: string; invoice_date: string; invoice_origin: string | false
      partner_id: [number, string] | false; amount_total: number; currency_id: [number, string]
    }[]

    const supabase = createServerClient()
    const { data: already } = await supabase
      .from('invoice_emails')
      .select('odoo_invoice_id')
      .in('odoo_invoice_id', invoices.map((i) => i.id))
    const handled = new Set((already ?? []).map((r: { odoo_invoice_id: number }) => r.odoo_invoice_id))

    let pending = invoices.filter((i) => !handled.has(i.id))
    // In test mode only ever touch one, and do not consult or write the log, so the sample can be
    // re-sent as often as needed without burning a real invoice's one-and-only send.
    if (testTo) pending = invoices.slice(0, 1)

    const capped = pending.slice(0, MAX_PER_RUN)
    const results: Record<string, unknown>[] = []

    for (const inv of capped) {
      const orderName = (inv.invoice_origin || '').split(',')[0].trim()
      const partnerId = inv.partner_id ? inv.partner_id[0] : null

      // Recipient: the billed contact, then its parent company. 23 of 74 billed partners have no
      // address at all, so this is recorded as skipped rather than treated as a failure.
      let recipient = ''
      if (partnerId) {
        const rows = await callKw(sessionId, 'res.partner', 'read', [[partnerId]],
          { fields: ['email', 'commercial_partner_id'] }, { scopeToCompany: false }) as
          { email: string | false; commercial_partner_id: [number, string] | false }[]
        recipient = rows[0]?.email || ''
        if (!recipient && rows[0]?.commercial_partner_id) {
          const parent = await callKw(sessionId, 'res.partner', 'read', [[rows[0].commercial_partner_id[0]]],
            { fields: ['email'] }, { scopeToCompany: false }) as { email: string | false }[]
          recipient = parent[0]?.email || ''
        }
      }
      const to = testTo || recipient

      if (!to) {
        results.push({ invoice: inv.name, status: 'skipped_no_email' })
        if (!dry && !testTo) {
          await supabase.from('invoice_emails').insert({
            odoo_invoice_id: inv.id, invoice_name: inv.name, order_name: orderName,
            partner_id: partnerId, recipient: null, status: 'skipped_no_email',
            detail: 'no email on the billed contact or its parent',
          })
        }
        continue
      }

      if (dry) {
        results.push({ invoice: inv.name, order: orderName, would_email: to })
        continue
      }

      const built = await buildForInvoice(sessionId, orderName, inv, callKw, searchRead, COMPANY_ID, getCompanyDetails)
      const attachments: { filename: string; content: string }[] = []
      if (built.orderPdf) attachments.push({ filename: `${orderName || 'order'}.pdf`, content: built.orderPdf })

      // Odoo stores the invoice PDF on posting, so the customer gets the real billing document
      // alongside ours rather than a second version of the same numbers.
      const invAtt = await searchRead(sessionId, 'ir.attachment',
        [['res_model', '=', 'account.move'], ['res_id', '=', inv.id], ['mimetype', '=', 'application/pdf']],
        ['datas'], { limit: 1, order: 'write_date desc' })
      if (invAtt.length > 0 && invAtt[0].datas) {
        attachments.push({ filename: `${inv.name.replace(/\//g, '-')}.pdf`, content: invAtt[0].datas as string })
      }

      const html = renderInvoiceEmail({
        invoiceName: inv.name,
        orderName,
        customerName: inv.partner_id ? inv.partner_id[1] : '',
        amountTotal: inv.amount_total,
        currency: inv.currency_id ? inv.currency_id[1] : 'THB',
        invoiceDate: inv.invoice_date,
        shortLines: built.shortLines,
        deliveredInFull: built.deliveredInFull,
        physicalCount: built.physicalCount,
      })

      const ok = await sendEmail({
        to,
        subject: `${inv.name} · Invoice and delivery note${built.shortLines.length ? ' (items short)' : ''}`,
        html,
        attachments,
      })

      results.push({ invoice: inv.name, order: orderName, to, sent: ok })

      if (!testTo) {
        await supabase.from('invoice_emails').insert({
          odoo_invoice_id: inv.id, invoice_name: inv.name, order_name: orderName,
          partner_id: partnerId, recipient: to, status: ok ? 'sent' : 'failed',
          detail: ok ? null : 'resend rejected the message',
        })
      }
    }

    return NextResponse.json({
      mode: testTo ? 'test' : dry ? 'dry' : 'live',
      start_date: START_DATE,
      eligible: pending.length,
      processed: results.length,
      results,
    })
  } catch (err) {
    console.error('invoice email cron error:', err)
    return NextResponse.json({ error: 'CRON_FAILED', message: String(err) }, { status: 500 })
  }
}

// Assemble the order document for the invoice's originating sale order. Returns base64 so it can
// go straight to Resend, plus the delivery figures the email body quotes.
async function buildForInvoice(
  sessionId: string,
  orderName: string,
  inv: { name: string },
  callKw: typeof import('@/lib/odoo/client').callKw,
  searchRead: typeof import('@/lib/odoo/client').searchRead,
  companyId: number,
  getCompanyDetails: typeof import('@/lib/odoo/odoo-helpers').getCompanyDetails,
): Promise<{ orderPdf: string | null; shortLines: string[]; deliveredInFull: number; physicalCount: number }> {
  const empty = { orderPdf: null, shortLines: [], deliveredInFull: 0, physicalCount: 0 }
  if (!orderName) return empty

  const orders = await searchRead(sessionId, 'sale.order',
    [['name', '=', orderName], ['company_id', '=', companyId]],
    ['id', 'name', 'date_order', 'commitment_date', 'client_order_ref', 'note',
      'currency_id', 'amount_untaxed', 'amount_tax', 'amount_total', 'partner_shipping_id'],
    { limit: 1 },
  ) as unknown as {
    id: number; name: string; date_order: string; commitment_date: string | false
    client_order_ref: string | false; note: string | false; currency_id: [number, string]
    amount_untaxed: number; amount_tax: number; amount_total: number
    partner_shipping_id: [number, string] | false
  }[]
  const order = orders[0]
  if (!order) return empty

  const rawLines = await searchRead(sessionId, 'sale.order.line',
    [['order_id', '=', order.id], ['display_type', '=', false]],
    ['product_id', 'name', 'product_uom_qty', 'qty_delivered', 'qty_invoiced',
      'qty_delivered_method', 'product_uom', 'product_packaging_id', 'product_packaging_qty', 'price_total'],
    { order: 'sequence, id', limit: 0 },
  ) as unknown as {
    product_id: [number, string] | false; name: string; product_uom_qty: number
    qty_delivered: number; qty_invoiced: number; qty_delivered_method: string
    product_uom: [number, string] | false; product_packaging_id: [number, string] | false
    product_packaging_qty: number; price_total: number
  }[]

  const uomIds = Array.from(new Set(rawLines.map((l) => (l.product_uom ? l.product_uom[0] : 0)).filter(Boolean)))
  const weightUomIds = new Set<number>()
  if (uomIds.length > 0) {
    const uoms = await callKw(sessionId, 'uom.uom', 'read', [uomIds], { fields: ['id', 'category_id'] }) as
      { id: number; category_id: [number, string] | false }[]
    uoms.forEach((u) => { if (u.category_id && u.category_id[1] === 'Weight') weightUomIds.add(u.id) })
  }

  const variantIds = Array.from(new Set(rawLines.map((l) => (l.product_id ? l.product_id[0] : 0)).filter(Boolean)))
  const skuMap: Record<number, string> = {}
  if (variantIds.length > 0) {
    const variants = await callKw(sessionId, 'product.product', 'read', [variantIds], { fields: ['id', 'default_code'] }) as
      { id: number; default_code: string | false }[]
    variants.forEach((v) => { skuMap[v.id] = v.default_code || '' })
  }

  const shipId = order.partner_shipping_id ? order.partner_shipping_id[0] : null
  const ship = shipId
    ? await callKw(sessionId, 'res.partner', 'read', [[shipId]],
        { fields: ['name', 'street', 'city', 'country_id'] }, { scopeToCompany: false }) as
      { name: string; street: string | false; city: string | false; country_id: [number, string] | false }[]
    : []
  const company = await getCompanyDetails(companyId)

  const lines: OrderPdfLine[] = rawLines.map((l) => ({
    product_name: l.product_id ? l.product_id[1] : l.name,
    sku: l.product_id ? (skuMap[l.product_id[0]] ?? '') : '',
    packaging_name: l.product_packaging_id ? l.product_packaging_id[1] : '',
    packaging_qty: l.product_packaging_qty,
    unit_qty: l.product_uom_qty,
    uom: l.product_uom ? l.product_uom[1] : '',
    qty_delivered: l.qty_delivered,
    qty_invoiced: l.qty_invoiced,
    deliverable: l.qty_delivered_method === 'stock_move',
    weighed: weightUomIds.has(l.product_uom ? l.product_uom[0] : 0),
    price_total: l.price_total,
  }))

  const physical = lines.filter((l) => l.deliverable)
  const short = lines.filter((l) => l.deliverable && !l.weighed && l.qty_delivered < l.unit_qty)

  const { deliveryStateFromLines, DELIVERY_STATE_LABELS } = await import('@/lib/order-labels')
  const st = deliveryStateFromLines(lines.map((l) => ({
    qty_ordered: l.unit_qty, qty_delivered: l.qty_delivered, deliverable: l.deliverable, weighed: l.weighed,
  })))

  const bytes = await buildOrderPdf({
    name: order.name,
    date_order: order.date_order,
    commitment_date: order.commitment_date || null,
    client_order_ref: order.client_order_ref || null,
    state_label: st === 'unknown' ? 'Confirmed' : DELIVERY_STATE_LABELS[st],
    currency: order.currency_id ? order.currency_id[1] : 'THB',
    note: order.note || null,
    ship_to: {
      name: ship[0]?.name ?? '',
      street: ship[0]?.street || '',
      city: ship[0]?.city || '',
      country: ship[0]?.country_id ? ship[0].country_id[1] : '',
    },
    company: {
      name: company?.name ?? '', street: company?.street ?? '', street2: company?.street2 ?? '',
      city: company?.city ?? '', zip: company?.zip ?? '', state: company?.state ?? '',
      country: company?.country ?? '', vat: company?.vat ?? '', phone: company?.phone ?? '',
      email: company?.email ?? '', website: company?.website ?? '',
    },
    lines,
    amount_untaxed: order.amount_untaxed,
    amount_tax: order.amount_tax,
    amount_total: order.amount_total,
  })

  return {
    orderPdf: Buffer.from(bytes).toString('base64'),
    shortLines: short.map((l) => `${l.product_name} (ordered ${l.unit_qty}, sent ${l.qty_delivered})`),
    deliveredInFull: physical.length - short.length,
    physicalCount: physical.length,
  }
}
