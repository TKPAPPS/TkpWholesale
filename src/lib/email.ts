// Best-effort transactional email via Resend. Never throws — email is a
// notification, not part of the order transaction, so a delivery failure must not
// fail the caller. Returns true on a 2xx from Resend, false otherwise.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey || !from) {
    console.warn('sendEmail skipped: RESEND_API_KEY / EMAIL_FROM not configured')
    return false
  }
  if (!opts.to) return false
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn('sendEmail failed:', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.warn('sendEmail error:', err)
    return false
  }
}

interface PlacedEmailData {
  lang: 'en' | 'he'
  orderName: string
  runDate: string
  items: { label: string; qty: number }[]
  total: string
  nextRunDate: string | null
  orderId: number
  addressSubstituted: boolean
}

interface FailedEmailData {
  lang: 'en' | 'he'
  runDate: string
  reason: string
  paused: boolean
}

function shell(lang: 'en' | 'he', body: string): string {
  const dir = lang === 'he' ? 'rtl' : 'ltr'
  return `<div dir="${dir}" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.5">${body}<p style="color:#9ca3af;font-size:12px;margin-top:24px">TKP Wholesale</p></div>`
}

export function scheduledPlacedEmail(d: PlacedEmailData): { subject: string; html: string } {
  const he = d.lang === 'he'
  const itemRows = d.items
    .map((i) => `<tr><td style="padding:4px 0">${escapeHtml(i.label)}</td><td style="padding:4px 0;text-align:${he ? 'left' : 'right'}">× ${i.qty}</td></tr>`)
    .join('')
  const nextLine = d.nextRunDate
    ? (he ? `ההזמנה הבאה תבוצע ב-${d.nextRunDate}.` : `Your next order will be placed on ${d.nextRunDate}.`)
    : (he ? 'זו הייתה ההזמנה האחרונה בתזמון זה.' : 'This was the final order in this schedule.')
  const substituted = d.addressSubstituted
    ? (he ? '<p style="color:#b45309">שים לב: כתובת המשלוח שנשמרה אינה זמינה עוד, ולכן השתמשנו בכתובת הראשית שלך.</p>' : '<p style="color:#b45309">Note: your saved delivery address was unavailable, so we used your main address.</p>')
    : ''
  const subject = he ? `ההזמנה הקבועה שלך ${d.orderName} בוצעה` : `Your scheduled order ${d.orderName} has been placed`
  const body = he
    ? `<h2 style="font-size:18px">ההזמנה הקבועה שלך בוצעה</h2>
       <p>הזמנה <strong>${escapeHtml(d.orderName)}</strong> בוצעה בתאריך ${d.runDate}.</p>
       <table style="width:100%;font-size:14px;border-collapse:collapse">${itemRows}</table>
       <p style="font-size:15px;margin-top:12px"><strong>סה"כ: ${escapeHtml(d.total)}</strong></p>
       ${substituted}
       <p>${nextLine}</p>`
    : `<h2 style="font-size:18px">Your scheduled order has been placed</h2>
       <p>Order <strong>${escapeHtml(d.orderName)}</strong> was placed on ${d.runDate}.</p>
       <table style="width:100%;font-size:14px;border-collapse:collapse">${itemRows}</table>
       <p style="font-size:15px;margin-top:12px"><strong>Total: ${escapeHtml(d.total)}</strong></p>
       ${substituted}
       <p>${nextLine}</p>`
  return { subject, html: shell(d.lang, body) }
}

export function scheduledFailedEmail(d: FailedEmailData): { subject: string; html: string } {
  const he = d.lang === 'he'
  const pausedLine = d.paused
    ? (he ? '<p style="color:#b45309">התזמון הושהה לאחר מספר כשלונות. אנא בדוק אותו ב"הזמנות קבועות".</p>' : '<p style="color:#b45309">This schedule has been paused after repeated failures. Please review it in Scheduled Orders.</p>')
    : (he ? '<p>ננסה שוב מחר.</p>' : '<p>We will try again tomorrow.</p>')
  const subject = he ? 'לא הצלחנו לבצע את ההזמנה הקבועה שלך' : 'We could not place your scheduled order'
  const body = he
    ? `<h2 style="font-size:18px">בעיה בהזמנה קבועה</h2>
       <p>לא הצלחנו לבצע את ההזמנה הקבועה שלך בתאריך ${d.runDate}.</p>
       <p style="color:#6b7280">${escapeHtml(d.reason)}</p>
       ${pausedLine}`
    : `<h2 style="font-size:18px">Scheduled order problem</h2>
       <p>We could not place your scheduled order on ${d.runDate}.</p>
       <p style="color:#6b7280">${escapeHtml(d.reason)}</p>
       ${pausedLine}`
  return { subject, html: shell(d.lang, body) }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
