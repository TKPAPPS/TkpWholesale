import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'

// Order PDF, generated here rather than by Odoo.
//
// Odoo cannot produce this one: 17+ removed the public ir.actions.report.render_qweb_pdf and
// the private replacement is unreachable over RPC, sales orders carry no stored PDF attachment
// the way invoices do, and the SaaS instance refuses an API key for the web session that
// /report/pdf would need. Generating it here also means the document can show ordered against
// delivered, which Odoo's own sales order report does not carry at all.
//
// Deliberately English only. The standard PDF fonts are Latin-1, so Hebrew would need an
// embedded font plus bidi reordering; business documents here go out in English anyway, and
// formatCurrency already renders en-US. Any character outside Latin-1 is stripped rather than
// allowed to throw at render time (see `safe`).

export interface OrderPdfLine {
  product_name: string
  sku: string
  packaging_name: string
  packaging_qty: number
  unit_qty: number
  uom: string
  qty_delivered: number
  qty_invoiced: number
  deliverable: boolean
  weighed: boolean
  price_total: number
}

export interface OrderPdfData {
  name: string
  date_order: string
  commitment_date?: string | null
  client_order_ref?: string | null
  state_label: string
  currency: string
  note?: string | null
  ship_to: { name: string; street?: string; city?: string; country?: string }
  company: { name: string; street?: string; city?: string; country?: string; vat?: string; phone?: string }
  lines: OrderPdfLine[]
  amount_untaxed: number
  amount_tax: number
  amount_total: number
}

const A4 = { w: 595.28, h: 841.89 }
const M = 46                      // page margin
const BURGUNDY = rgb(0.420, 0.082, 0.208)   // #6B1535
const GOLD = rgb(0.784, 0.659, 0.294)       // #C8A84B
const INK = rgb(0.11, 0.08, 0.09)
const MUTED = rgb(0.45, 0.40, 0.42)
const FAINT = rgb(0.72, 0.68, 0.70)
const RULE = rgb(0.90, 0.88, 0.89)
const SHORT_BG = rgb(0.992, 0.961, 0.969)   // brand-50

// Columns, measured from the left margin.
// Right edges are what matter, since every figure is right-aligned. The Delivered column ends
// at 456 and the widest Amount ("THB 136,420.00" at 9pt bold) starts near 473, which keeps a
// real gap between them; at the previous 486 the two columns collided and read as "6 THB 3,510".
const COL = { desc: M, ordered: 348, delivered: 394, amount: A4.w - M }

// Standard PDF fonts are Latin-1. A Thai or Hebrew character in a product name would otherwise
// throw at draw time and fail the whole download, so anything unrepresentable is dropped.
function safe(s: unknown): string {
  return String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim()
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d?: string | null): string {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

// Trim a number the way the screen does: whole numbers stay whole, weights keep their decimals.
function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

// Greedy wrap against real measured width, so long product names never run into the Ordered
// column. Returns at most `maxLines`, ellipsising the last.
function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= maxWidth) { line = next; continue }
    if (line) lines.push(line)
    line = w
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === 0) return ['']
  // Ellipsis if anything was dropped
  const joined = lines.join(' ')
  if (joined.length < safe(text).length) {
    let last = lines[lines.length - 1]
    while (last && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last}...`
  }
  return lines
}

export async function buildOrderPdf(d: OrderPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Order ${safe(d.name)}`)
  pdf.setCreator('The Kosher Place Wholesale')

  const body = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold)

  const isShort = (l: OrderPdfLine) => l.deliverable && !l.weighed && l.qty_delivered < l.unit_qty
  const physical = d.lines.filter((l) => l.deliverable)
  const shortLines = d.lines.filter(isShort)

  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = 0

  const right = (p: PDFPage, text: string, x: number, yy: number, f: PDFFont, size: number, color = INK) =>
    p.drawText(text, { x: x - f.widthOfTextAtSize(text, size), y: yy, size, font: f, color })

  // ---- table header, repeated on every page so a 49-line order stays readable
  const drawTableHead = (p: PDFPage, startY: number): number => {
    p.drawRectangle({ x: M, y: startY - 15, width: A4.w - M * 2, height: 20, color: rgb(0.976, 0.969, 0.973) })
    p.drawText('DESCRIPTION', { x: COL.desc + 6, y: startY - 9, size: 7, font: bold, color: MUTED })
    right(p, 'ORDERED', COL.ordered + 46, startY - 9, bold, 7, MUTED)
    right(p, 'DELIVERED', COL.delivered + 62, startY - 9, bold, 7, MUTED)
    right(p, 'AMOUNT', COL.amount - 6, startY - 9, bold, 7, MUTED)
    return startY - 26
  }

  const newPage = (): number => {
    page = pdf.addPage([A4.w, A4.h])
    return drawTableHead(page, A4.h - M)
  }

  // ---------- masthead ----------
  y = A4.h - M
  page.drawText('THE KOSHER PLACE', { x: M, y: y - 16, size: 17, font: serif, color: BURGUNDY })
  y -= 30
  const issuer = [d.company.street, d.company.city, d.company.country].filter(Boolean).map(safe)
  if (d.company.vat) issuer.push(`Tax ID: ${safe(d.company.vat)}`)
  if (d.company.phone) issuer.push(safe(d.company.phone))
  issuer.forEach((l) => { page.drawText(l, { x: M, y, size: 7.5, font: body, color: MUTED }); y -= 10 })

  // document identity, on the end side
  let ry = A4.h - M - 14
  right(page, 'ORDER', A4.w - M, ry, serif, 20, INK)
  ry -= 16
  right(page, safe(d.name), A4.w - M, ry, bold, 10, INK)
  ry -= 14
  const meta: [string, string][] = [['Order date', fmtDate(d.date_order)]]
  if (d.commitment_date) meta.push(['Requested delivery', fmtDate(d.commitment_date)])
  if (d.client_order_ref) meta.push(['PO / Reference', safe(d.client_order_ref)])
  meta.forEach(([k, v]) => {
    right(page, v, A4.w - M, ry, bold, 8, INK)
    right(page, k, A4.w - M - Math.max(bold.widthOfTextAtSize(v, 8) + 8, 8), ry, body, 8, MUTED)
    ry -= 11
  })

  // ---------- deliver to ----------
  y = Math.min(y, ry) - 12
  page.drawText('DELIVER TO', { x: M, y, size: 7, font: bold, color: MUTED })
  y -= 13
  page.drawText(safe(d.ship_to.name), { x: M, y, size: 10.5, font: bold, color: INK })
  y -= 12
  ;[d.ship_to.street, d.ship_to.city, d.ship_to.country].filter(Boolean).forEach((l) => {
    page.drawText(safe(l), { x: M, y, size: 8, font: body, color: MUTED }); y -= 10
  })

  // gold hairline, the one ceremonial mark the brand uses
  y -= 8
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1, color: GOLD })
  y -= 22

  // ---------- delivery summary ----------
  page.drawText('DELIVERY', { x: M, y, size: 7, font: bold, color: MUTED })
  y -= 20
  if (shortLines.length > 0) {
    page.drawText(`${shortLines.length} short`, { x: M, y, size: 19, font: serif, color: BURGUNDY })
    y -= 14
    page.drawText(`${physical.length - shortLines.length} of ${physical.length} items delivered in full`,
      { x: M, y, size: 9, font: body, color: MUTED })
  } else {
    page.drawText(safe(d.state_label), { x: M, y, size: 19, font: serif, color: INK })
    y -= 14
    page.drawText(physical.length > 0 ? 'Everything on this order was delivered' : 'No delivery recorded yet',
      { x: M, y, size: 9, font: body, color: MUTED })
  }
  y -= 22

  // ---------- line items ----------
  y = drawTableHead(page, y)

  const descWidth = COL.ordered - COL.desc - 24
  for (const l of d.lines) {
    const nameLines = wrap(l.product_name, body, 9, descWidth)
    const sub = [safe(l.sku), `${safe(l.packaging_name)}${l.packaging_qty ? ` x ${qty(l.packaging_qty)}` : ''}`]
      .filter(Boolean).join('  ')
    const short = isShort(l)
    const notes: string[] = []
    if (short) notes.push(l.qty_delivered === 0 ? 'Not sent' : `Short by ${qty(l.unit_qty - l.qty_delivered)}`)
    if (l.weighed && l.deliverable) notes.push('weighed at picking')
    if (l.deliverable && l.qty_delivered > 0 && l.qty_invoiced === 0) notes.push('not yet invoiced')

    const rowH = 14 + nameLines.length * 11 + (notes.length ? 10 : 0)
    // Reserve only a row's worth of space. Reserving room for the totals block on EVERY row
    // left ~90pt idle at the foot of every page and pushed long orders onto extra sheets.
    if (y - rowH < M + 40) y = newPage()

    if (short) {
      page.drawRectangle({ x: M, y: y - rowH + 8, width: A4.w - M * 2, height: rowH, color: SHORT_BG })
    }

    let ly = y
    nameLines.forEach((ln) => { page.drawText(ln, { x: COL.desc + 6, y: ly, size: 9, font: body, color: INK }); ly -= 11 })
    if (sub) { page.drawText(sub, { x: COL.desc + 6, y: ly, size: 7, font: body, color: FAINT }); ly -= 10 }
    if (notes.length) {
      page.drawText(notes.join('   '), { x: COL.desc + 6, y: ly, size: 7, font: bold, color: short ? BURGUNDY : FAINT })
    }

    const orderedTxt = `${qty(l.unit_qty)}${l.uom ? ` ${safe(l.uom)}` : ''}`
    right(page, orderedTxt, COL.ordered + 46, y, body, 9, MUTED)
    if (l.deliverable) {
      const delTxt = `${qty(l.qty_delivered)}${l.weighed && l.uom ? ` ${safe(l.uom)}` : ''}`
      right(page, delTxt, COL.delivered + 62, y, short ? bold : body, 9, short ? BURGUNDY : INK)
    } else {
      right(page, 'Charge', COL.delivered + 62, y, body, 9, FAINT)
    }
    right(page, money(l.price_total, d.currency), COL.amount - 6, y, bold, 9, INK)

    y -= rowH
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: A4.w - M, y: y + 6 }, thickness: 0.5, color: RULE })
  }

  // ---------- totals ----------
  if (y < M + 96) y = newPage()
  y -= 16
  const tx = A4.w - M
  const label = (s: string, v: string, f: PDFFont, size: number, color = INK) => {
    right(page, s, tx - 118, y, body, size, MUTED)
    right(page, v, tx, y, f, size, color)
    y -= 14
  }
  label('Subtotal', money(d.amount_untaxed, d.currency), body, 9)
  label('VAT', money(d.amount_tax, d.currency), body, 9)
  page.drawLine({ start: { x: tx - 176, y: y + 6 }, end: { x: tx, y: y + 6 }, thickness: 0.5, color: RULE })
  y -= 4
  right(page, 'Total', tx - 118, y, bold, 10, INK)
  right(page, money(d.amount_total, d.currency), tx, y, serif, 13, BURGUNDY)
  y -= 26

  // ---------- note ----------
  if (d.note) {
    if (y < M + 50) y = newPage()
    page.drawText('ORDER NOTE', { x: M, y, size: 7, font: bold, color: MUTED })
    y -= 12
    wrap(d.note, body, 8.5, A4.w - M * 2, 4).forEach((ln) => {
      page.drawText(ln, { x: M, y, size: 8.5, font: body, color: MUTED }); y -= 11
    })
  }

  // ---------- page numbers, once the total is known ----------
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    const txt = `${safe(d.name)}   ${i + 1} of ${pages.length}`
    p.drawText(txt, { x: M, y: M - 16, size: 7, font: body, color: FAINT })
  })

  return pdf.save()
}
