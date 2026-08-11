import { NextRequest, NextResponse } from 'next/server'
import { MOCK_INVOICE_DETAIL } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

function computeStateLabel(paymentState: string, dueDateStr: string | null): string {
  if (paymentState === 'paid') return 'Paid'
  if (paymentState === 'in_payment') return 'In Payment'
  if (paymentState === 'partial') return 'Partial'
  if (dueDateStr && new Date(dueDateStr) < new Date()) return 'Overdue'
  return 'Due'
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
  }

  if (USE_MOCK) {
    if (id !== 201) return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    return NextResponse.json(MOCK_INVOICE_DETAIL)
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { callKw, searchRead } = await import('@/lib/odoo/client')
    const { getCompanyDetails, getWebsiteCompanyId } = await import('@/lib/odoo/odoo-helpers')

    // Fetch invoice + verify ownership via commercial_partner_id. The extra fields here
    // (partner_id, company_id, origin/refs, payment term, amount_paid) are all plain columns
    // on account.move, so they cost nothing beyond the read we already do.
    const moves = await callKw(sessionId, 'account.move', 'read', [[id]], {
      fields: ['id', 'name', 'invoice_date', 'invoice_date_due', 'amount_total',
        'amount_residual', 'amount_untaxed', 'amount_tax', 'payment_state',
        'currency_id', 'commercial_partner_id', 'state', 'move_type', 'narration',
        'partner_id', 'company_id', 'invoice_origin', 'ref', 'payment_reference',
        'invoice_payment_term_id'],
    }) as {
      id: number; name: string; invoice_date: string; invoice_date_due: string | false;
      amount_total: number; amount_residual: number; amount_untaxed: number; amount_tax: number;
      payment_state: string; currency_id: [number, string]; state: string; move_type: string;
      commercial_partner_id: [number, string] | false; narration: string | false;
      partner_id: [number, string] | false; company_id: [number, string] | false;
      invoice_origin: string | false; ref: string | false; payment_reference: string | false;
      invoice_payment_term_id: [number, string] | false;
    }[]

    const move = moves[0]
    if (!move || move.move_type !== 'out_invoice' || move.state !== 'posted') {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    // Ownership check
    const ownerId = move.commercial_partner_id ? move.commercial_partner_id[0] : null
    if (ownerId !== parsed.commercial_partner_id) {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    // Charge lines only. `display_type = 'product'` is the exact set Odoo prints as invoice
    // lines: it INCLUDES manual charge lines that carry no product (which the previous
    // `product_id != false` filter silently dropped, so lines could fail to sum to the
    // subtotal), and EXCLUDES the bookkeeping rows that also live on account.move.line —
    // 'tax' and 'payment_term' (verified present on real invoices; rendering them would put
    // qty-0 / amount-0 junk rows in the table). Verified against 40 recent posted invoices:
    // sum(price_subtotal) == amount_untaxed on all 40. Ordered like the printed invoice.
    const lines = await searchRead(sessionId, 'account.move.line',
      [['move_id', '=', id], ['display_type', '=', 'product']],
      ['id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'price_total', 'product_id', 'product_uom_id'],
      { order: 'sequence, id' },
    ) as {
      id: number; name: string; quantity: number; price_unit: number; price_subtotal: number
      price_total: number; product_id: [number, string] | false; product_uom_id: [number, string] | false
    }[]

    // Bill-to address, issuer details, and per-line SKUs in parallel. The company read is
    // cached for a day, so it is effectively free after the first hit.
    const billToId = move.partner_id ? move.partner_id[0] : null
    const invoiceCompanyId = move.company_id ? move.company_id[0] : null
    const variantIds = Array.from(new Set(lines.map((l) => (l.product_id ? l.product_id[0] : 0)).filter(Boolean)))
    const [billToRows, company, variants, websiteCompanyId] = await Promise.all([
      billToId
        ? callKw(sessionId, 'res.partner', 'read', [[billToId]], {
            fields: ['id', 'name', 'street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'vat'],
          }) as Promise<{
            id: number; name: string; street: string | false; street2: string | false
            city: string | false; zip: string | false; state_id: [number, string] | false
            country_id: [number, string] | false; vat: string | false
          }[]>
        : Promise.resolve([]),
      getCompanyDetails(invoiceCompanyId),
      variantIds.length > 0
        ? callKw(sessionId, 'product.product', 'read', [variantIds], { fields: ['id', 'default_code'] }) as Promise<{ id: number; default_code: string | false }[]>
        : Promise.resolve([] as { id: number; default_code: string | false }[]),
      getWebsiteCompanyId(),
    ])

    const b = billToRows[0]
    const bill_to = b
      ? {
          name: b.name || '',
          street: b.street || '',
          street2: b.street2 || '',
          city: b.city || '',
          zip: b.zip || '',
          state: b.state_id ? b.state_id[1] : '',
          country: b.country_id ? b.country_id[1] : '',
          vat: b.vat || '',
        }
      : null

    const skuMap: Record<number, string> = {}
    variants.forEach((v) => { skuMap[v.id] = v.default_code || '' })

    return NextResponse.json({
      id: move.id,
      name: move.name,
      invoice_date: move.invoice_date,
      invoice_date_due: move.invoice_date_due || null,
      amount_total: move.amount_total,
      amount_residual: move.amount_residual,
      amount_untaxed: move.amount_untaxed,
      amount_tax: move.amount_tax,
      payment_state: move.payment_state,
      currency: move.currency_id[1] ?? 'THB',
      state_label: computeStateLabel(move.payment_state, move.invoice_date_due || null),
      line_count: lines.length,
      note: move.narration || '',
      bill_to,
      company,
      // Invoices in this group are issued by several companies (e.g. Jcafe Sukhumvit), not
      // only the portal's own company. The page shows the Kosher Place wordmark ONLY when
      // the issuer really is that company; otherwise the issuer's name stands alone.
      is_website_company: !!invoiceCompanyId && invoiceCompanyId === websiteCompanyId,
      invoice_origin: move.invoice_origin || '',
      reference: move.payment_reference || move.ref || '',
      payment_term: move.invoice_payment_term_id ? move.invoice_payment_term_id[1] : '',
      lines: lines.map((l) => ({
        line_id: l.id,
        name: l.name,
        sku: l.product_id ? (skuMap[l.product_id[0]] ?? '') : '',
        uom: l.product_uom_id ? l.product_uom_id[1] : '',
        quantity: l.quantity,
        price_unit: l.price_unit,
        // NET unit price for the document's line table. Odoo's `price_unit` is the price as
        // entered, which under this company's price-INCLUDED VAT is gross (e.g. 20.00) while
        // `price_subtotal` is net (18.69) — printing both on one row makes qty x unit fail to
        // equal the amount, and makes the Amount column fail to sum to the Subtotal. Deriving
        // the net unit keeps the arithmetic on the page self-consistent, which is the whole
        // point of an invoice. Falls back to price_unit when quantity is 0.
        price_unit_net: l.quantity ? Math.round((l.price_subtotal / l.quantity) * 100) / 100 : l.price_unit,
        price_subtotal: l.price_subtotal,
        price_total: l.price_total,
      })),
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('invoice detail error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
