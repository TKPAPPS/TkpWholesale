// The invoice / delivery email body.
//
// Kept plain on purpose. This lands in warehouse and accounts inboxes, gets forwarded, printed and
// read on phones, so it is a single-column table layout with inline styles and no external assets:
// the things that survive Outlook and Gmail's clipping. The two PDFs carry the detail; the body
// only has to say what arrived, whether anything is missing, and what it costs.

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface InvoiceEmailData {
  invoiceName: string
  orderName: string
  customerName: string
  amountTotal: number
  currency: string
  invoiceDate: string
  shortLines: string[]
  deliveredInFull: number
  physicalCount: number
}

const BURGUNDY = '#6B1535'
const GOLD = '#C8A84B'
const INK = '#1C1418'
const MUTED = '#6E626A'

export function renderInvoiceEmail(d: InvoiceEmailData): string {
  const hasShort = d.shortLines.length > 0

  // Named plainly. "Some items were not sent" is the fact; dressing it up as an apology invites a
  // reply about the apology rather than about the goods.
  const summary = hasShort
    ? `<p style="margin:0 0 6px;font-size:17px;font-weight:600;color:${BURGUNDY}">
         ${d.shortLines.length} item${d.shortLines.length === 1 ? '' : 's'} on this order ${d.shortLines.length === 1 ? 'was' : 'were'} not sent in full
       </p>
       <p style="margin:0;font-size:14px;color:${MUTED}">
         ${d.deliveredInFull} of ${d.physicalCount} items were delivered in full.
       </p>`
    : `<p style="margin:0;font-size:17px;font-weight:600;color:${INK}">
         Everything on this order was delivered.
       </p>`

  const shortList = hasShort
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:14px 0 0;border-collapse:collapse">
         ${d.shortLines.map((l) => `
           <tr><td style="padding:6px 10px;background:#fdf5f7;border-left:3px solid ${BURGUNDY};font-size:13px;color:${INK}">
             ${esc(l)}
           </td></tr>`).join('')}
       </table>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f4f5">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f6f4f5">
 <tr><td align="center" style="padding:28px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7dfe2;border-radius:10px">

   <tr><td style="padding:26px 28px 0">
     <div style="font-family:Georgia,'Times New Roman',serif;font-size:9px;letter-spacing:3px;color:${GOLD}">THE</div>
     <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${BURGUNDY};line-height:1.05">KOSHER</div>
     <div style="font-family:Georgia,'Times New Roman',serif;font-size:9px;letter-spacing:3px;color:${GOLD};padding-left:74px">PLACE</div>
   </td></tr>

   <tr><td style="padding:18px 28px 0"><div style="height:1px;background:${GOLD}"></div></td></tr>

   <tr><td style="padding:20px 28px 0;font-family:Arial,Helvetica,sans-serif">
     <p style="margin:0 0 16px;font-size:14px;color:${INK}">Dear ${esc(d.customerName) || 'customer'},</p>
     <p style="margin:0 0 18px;font-size:14px;color:${MUTED}">
       Invoice <strong style="color:${INK}">${esc(d.invoiceName)}</strong> for order
       <strong style="color:${INK}">${esc(d.orderName)}</strong> is attached, together with a delivery
       note showing what was ordered against what was actually sent.
     </p>
     ${summary}
     ${shortList}
   </td></tr>

   <tr><td style="padding:22px 28px 0;font-family:Arial,Helvetica,sans-serif">
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:1px solid #e7dfe2">
       <tr>
         <td style="padding:12px 0 0;font-size:13px;color:${MUTED}">Invoice total</td>
         <td style="padding:12px 0 0;font-size:17px;font-weight:700;color:${BURGUNDY};text-align:right;font-family:Georgia,serif">
           ${esc(money(d.amountTotal, d.currency))}
         </td>
       </tr>
     </table>
   </td></tr>

   <tr><td style="padding:22px 28px 26px;font-family:Arial,Helvetica,sans-serif">
     <p style="margin:0;font-size:12px;color:${MUTED}">
       Questions about this delivery? Reply to this email and we will look into it.
     </p>
   </td></tr>

   <tr><td style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif">
     <div style="border-top:1px solid #e7dfe2;padding-top:12px;font-size:11px;color:#a99ba2;line-height:1.6">
       The Kosher Place (Thailand) Co., Ltd. (Head Office)<br>
       66/4 Sukhumvit 20 (Mille Malle Community Mall), Room 301-302, 3rd floor<br>
       Khlong Toei, Bangkok 10110, Thailand &nbsp;·&nbsp; Tax ID 0105547143391<br>
       +66 2 106 4932 &nbsp;·&nbsp; www.kosherthailand.com
     </div>
   </td></tr>

  </table>
 </td></tr>
</table>
</body></html>`
}
