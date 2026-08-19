import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendEmailDetailed } from '@/lib/email'
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
const MAX_ATTEMPTS = 5

// Odoo's res.partner.email is free text and in this database frequently holds SEVERAL addresses
// in one field, with inconsistent separators and spacing:
//   "avi@x.com, yg@y.com"
//   "dovberbh@x.com , Chabadphangan@y.com , Yair@z.com"
//   "Yossi Goldberg <yg@x.com>"     (valid, Resend accepts the display-name form)
//   "3"                             (garbage on at least one partner)
// Passing the raw string to Resend as one recipient failed 30 of 67 sends on the first live day.
// Split, keep anything containing a plausible address, drop the rest.
function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || /<[^\s@]+@[^\s@]+\.[^\s@]+>/.test(s))
    .filter((s, i, a) => a.indexOf(s) === i)
}
// Deliberately small. At 15-minute intervals this still clears ~480 invoices a day against a
// real volume of ~48, so the only thing a bigger batch buys is a burst.
//
// The burst was the problem: on 2026-08-19 a run processed 8 invoices across 15:03-15:04 BKK and
// customers' add-to-cart calls began timing out seconds later, for about three minutes. Each
// invoice costs roughly eight Odoo calls, one of which pulls a ~128KB PDF attachment, so a batch
// saturates the shared Odoo workers and interactive requests queue behind it until they hit the
// 15s client timeout. The portal was competing with its own customers.
const MAX_PER_RUN = 5

// Breathing room between invoices, for the same reason. Cheap here, and it keeps a worker free
// for whoever is actually shopping.
const PAUSE_BETWEEN_MS = 1500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function unauthorized() {
  return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  // Its own secret, not the shared CRON_SECRET. The scheduled-orders job already runs on that
  // one from an external scheduler, so rotating or reusing it to test this endpoint risks
  // breaking a job that is working. Falls back to CRON_SECRET only if the dedicated one is unset.
  // Accepts EITHER secret. INVOICE_CRON_SECRET is the one used for manual runs, so testing this
  // endpoint never touches the shared CRON_SECRET the scheduled-orders job depends on. Vercel Cron
  // sends CRON_SECRET automatically as a bearer token, so accepting both lets the platform
  // scheduler work without the secret being written into vercel.json and committed.
  const given = req.nextUrl.searchParams.get('secret')
    ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const accepted = [process.env.INVOICE_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean)
  if (accepted.length === 0 || !given || !accepted.includes(given)) return unauthorized()

  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const testTo = req.nextUrl.searchParams.get('test')

  // `since` widens the window for a SAMPLE only, and is ignored unless ?test= names a recipient.
  // Gating it on test mode is the point: test mode sends to that one address, handles a single
  // invoice and never writes the log, so an older date cannot become a mass mailing of history.
  // In live mode the floor is always START_DATE.
  const sinceOverride = testTo ? req.nextUrl.searchParams.get('since') : null
  const floor = sinceOverride || START_DATE
  // Same gating: pick a specific invoice or originating order for the sample, so a particular
  // case (a short delivery, a weighed line) can be shown on demand rather than whatever happens
  // to be newest. Test mode only.
  const pick = testTo ? req.nextUrl.searchParams.get('invoice') : null

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
        ['invoice_date', '>=', floor],
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
      .select('odoo_invoice_id, status, attempts')
      .in('odoo_invoice_id', invoices.map((i) => i.id))
    // A FAILED row is not finished business: the first live day failed 30 of 67 on a recipient
    // parsing bug, and those customers still need their invoice. Failures are retried until
    // MAX_ATTEMPTS so a permanently bad address cannot loop forever.
    const rows = (already ?? []) as { odoo_invoice_id: number; status: string; attempts: number }[]
    const attemptsById = new Map(rows.map((r) => [r.odoo_invoice_id, r.attempts ?? 1]))
    const handled = new Set(
      rows.filter((r) => r.status === 'sent' || r.status === 'skipped_no_email'
        || (r.status === 'failed' && (r.attempts ?? 1) >= MAX_ATTEMPTS))
        .map((r) => r.odoo_invoice_id),
    )

    let pending = invoices.filter((i) => !handled.has(i.id))
    // In test mode only ever touch one, and do not consult or write the log, so the sample can be
    // re-sent as often as needed without burning a real invoice's one-and-only send.
    if (testTo) {
      const matched = pick
        ? invoices.filter((i) => i.name === pick || (i.invoice_origin || '').includes(pick))
        : invoices
      pending = matched.slice(0, 1)
    }

    const capped = pending.slice(0, MAX_PER_RUN)
    const results: Record<string, unknown>[] = []

    let processedCount = 0
    for (const inv of capped) {
      if (processedCount > 0 && !dry) await sleep(PAUSE_BETWEEN_MS)
      processedCount++
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
      const parsed = testTo ? [testTo] : parseRecipients(recipient)
      const to = parsed

      if (to.length === 0) {
        results.push({ invoice: inv.name, status: 'skipped_no_email', raw_email: recipient || null })
        if (!dry && !testTo) {
          await supabase.from('invoice_emails').upsert({
            odoo_invoice_id: inv.id, invoice_name: inv.name, order_name: orderName,
            partner_id: partnerId, recipient: null, status: 'skipped_no_email',
            detail: recipient ? `no usable address in "${recipient.slice(0, 120)}"` : 'no email on the billed contact or its parent',
            attempts: (attemptsById.get(inv.id) ?? 0) + 1,
          }, { onConflict: 'odoo_invoice_id' })
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
      // Two steps on purpose. Selecting `datas` pulls the whole base64 blob (~128KB per invoice)
      // and that is the single most expensive call in this loop, so ask for the id first and only
      // fetch the bytes when there is actually something to fetch.
      const invAttIds = await searchRead(sessionId, 'ir.attachment',
        [['res_model', '=', 'account.move'], ['res_id', '=', inv.id], ['mimetype', '=', 'application/pdf']],
        ['id'], { limit: 1, order: 'write_date desc' })
      if (invAttIds.length > 0) {
        const blob = await callKw(sessionId, 'ir.attachment', 'read', [[invAttIds[0].id as number]],
          { fields: ['datas'] }) as { datas: string | false }[]
        if (blob[0]?.datas) {
          attachments.push({ filename: `${inv.name.replace(/\//g, '-')}.pdf`, content: blob[0].datas })
        }
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

      const send = await sendEmailDetailed({
        to,
        subject: `${inv.name} · Invoice and delivery note${built.shortLines.length ? ' (items short)' : ''}`,
        html,
        attachments,
      })

      results.push({ invoice: inv.name, order: orderName, to, sent: send.ok, error: send.error })

      if (!testTo) {
        // Upsert, not insert: a retried invoice already has a row and the unique key would
        // reject a second one, so the failure would never clear.
        await supabase.from('invoice_emails').upsert({
          odoo_invoice_id: inv.id, invoice_name: inv.name, order_name: orderName,
          partner_id: partnerId, recipient: to.join(', '), status: send.ok ? 'sent' : 'failed',
          detail: send.ok ? null : (send.error ?? 'send failed'),
          attempts: (attemptsById.get(inv.id) ?? 0) + 1,
        }, { onConflict: 'odoo_invoice_id' })
      }
    }

    return NextResponse.json({
      mode: testTo ? 'test' : dry ? 'dry' : 'live',
      start_date: floor,
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
