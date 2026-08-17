import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { todayBkk, nextRunDate } from '@/lib/schedule-dates'
import { AUTO_PAUSE_AFTER_FAILURES } from '@/lib/scheduled-orders'
import { sendEmail, scheduledPlacedEmail, scheduledFailedEmail } from '@/lib/email'
import type { ScheduledOrderRow } from '@/lib/scheduled-orders-db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const USE_MOCK = process.env.USE_MOCK_API !== 'false'
const MAX_PER_RUN = 40

// Daily executor for scheduled/repeating orders. Triggered by the Vercel cron
// (GET, with Authorization: Bearer <CRON_SECRET>). Processes due schedules
// sequentially; one failure never kills the batch.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (USE_MOCK) return NextResponse.json({ skipped: 'mock' })

  const today = todayBkk()
  const supabase = createServerClient()

  // Sweep schedules whose end date has passed.
  await supabase.from('scheduled_orders').update({ status: 'ended' })
    .eq('status', 'active').lt('end_date', today).not('end_date', 'is', null)

  const { data, error } = await supabase
    .from('scheduled_orders')
    .select('*')
    .eq('status', 'active')
    .lte('next_run_date', today)
    .order('next_run_date', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('cron: due query failed:', error.message)
    return NextResponse.json({ error: 'QUERY_FAILED' }, { status: 503 })
  }

  const due = (data ?? []) as ScheduledOrderRow[]
  const summary = { processed: 0, placed: 0, failed: 0, skipped: 0 }

  let sessionId: string
  try {
    sessionId = await getOdooSession()
  } catch (e) {
    console.error('cron: could not get Odoo session:', e)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }

  const { callKw, searchRead, COMPANY_ID } = await import('@/lib/odoo/client')
  const { fetchDeliveryAddresses } = await import('@/lib/odoo/odoo-helpers')

  for (const s of due) {
    summary.processed++

    // Atomic claim - stamps last_run_date=today. Empty result = already claimed.
    const { data: claimed } = await supabase.rpc('claim_scheduled_order', { p_id: s.id, p_today: today })
    if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
      summary.skipped++
      continue
    }

    const runDate = s.next_run_date
    const idKey = `AUTO:${s.id.slice(0, 8)}:${runDate}`

    try {
      // Recovery: if a prior run crashed after action_confirm but before updating
      // the row, the order already exists under this deterministic ref - don't
      // place it again, just advance.
      const existing = await callKw(sessionId, 'sale.order', 'search_count',
        [[['client_order_ref', 'like', idKey], ['company_id', '=', COMPANY_ID]]], {}) as number
      if (existing > 0) {
        await advanceSchedule(supabase, s, runDate)
        summary.skipped++
        continue
      }

      // Re-validate the delivery address (it may have been archived). Fall back to
      // the commercial partner's own address, which is always in the list.
      const addresses = await fetchDeliveryAddresses(sessionId, s.commercial_partner_id)
      let shippingId = s.shipping_address_id
      let addressSubstituted = false
      if (!addresses.find(a => a.id === shippingId)) {
        const fallback = addresses.find(a => a.id === s.commercial_partner_id) ?? addresses[0]
        if (!fallback) throw new Error('No valid delivery address')
        shippingId = fallback.id
        addressSubstituted = true
      }

      // Create the order. NO pricelist_id (Odoo derives it), NO website_id (else
      // findCart would adopt it as the customer's cart before confirm).
      const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const clientRef = s.po_ref ? `${idKey} (${s.po_ref})` : idKey
      const orderId = await callKw(sessionId, 'sale.order', 'create', [{
        partner_id: s.partner_id,
        // Explicit: this create has no website_id either (deliberate, so findCart won't
        // adopt it as a cart), so nothing else would tie it to the right company.
        company_id: COMPANY_ID,
        partner_shipping_id: shippingId,
        client_order_ref: clientRef,
        origin: `Portal scheduled order ${s.id.slice(0, 8)}`,
        note: s.note || '',
        date_order: nowUtc,
        commitment_date: `${runDate} 02:00:00`, // 09:00 Bangkok in UTC
      }], {}) as number

      // All lines in one create call. No price_unit - Odoo computes pricelist price.
      const lineVals = s.items.map(i => ({
        order_id: orderId,
        product_id: i.product_id,
        product_uom_qty: i.uom_qty,
        ...(i.packaging_id ? { product_packaging_id: i.packaging_id, product_packaging_qty: i.packaging_qty } : {}),
      }))
      await callKw(sessionId, 'sale.order.line', 'create', [lineVals], {})

      // Unscoped for the same reason as the checkout route: a customer that resolves to a
      // sister company makes Odoo raise an inter-company purchase order in that company, which
      // a context pinned to allowed_company_ids [1] cannot do ("object is not bound"). A
      // scheduled order must not fail for the six branches the way a manual checkout did.
      await callKw(sessionId, 'sale.order', 'action_confirm', [[orderId]], {}, { scopeToCompany: false })

      const confirmed = await callKw(sessionId, 'sale.order', 'read', [[orderId]], {
        fields: ['id', 'name', 'amount_total', 'currency_id'],
      }) as { id: number; name: string; amount_total: number; currency_id: [number, string] }[]
      const co = confirmed[0]

      const next = await advanceSchedule(supabase, s, runDate, {
        last_order_id: orderId, last_order_name: co?.name ?? null,
        last_status: 'success', consecutive_failures: 0, last_error: null,
      })
      summary.placed++

      // Best-effort notification.
      const email = await partnerEmail(sessionId, s.partner_id, callKw)
      if (email) {
        const currency = co?.currency_id?.[1] ?? 'THB'
        const total = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(co?.amount_total ?? 0)
        const { subject, html } = scheduledPlacedEmail({
          lang: s.lang, orderName: co?.name ?? idKey, runDate,
          items: s.items.map(i => ({ label: s.lang === 'he' ? i.name_he : i.name, qty: i.packaging_qty || i.uom_qty })),
          total, nextRunDate: next, orderId, addressSubstituted,
        })
        await sendEmail({ to: email, subject, html })
      }
    } catch (err) {
      summary.failed++
      const reason = err instanceof Error ? err.message : 'Unknown error'
      console.error(`cron: schedule ${s.id} failed:`, reason)
      // Do NOT advance next_run_date - the claim guard resets tomorrow (last_run_date < today).
      const failures = s.consecutive_failures + 1
      const paused = failures >= AUTO_PAUSE_AFTER_FAILURES
      await supabase.from('scheduled_orders').update({
        consecutive_failures: failures,
        last_status: 'failed',
        last_error: reason.slice(0, 500),
        last_run_at: new Date().toISOString(),
        ...(paused ? { status: 'paused', paused_reason: 'failures' } : {}),
      }).eq('id', s.id)

      const email = await partnerEmail(sessionId, s.partner_id, callKw).catch(() => null)
      if (email) {
        const { subject, html } = scheduledFailedEmail({ lang: s.lang, runDate, reason: 'A problem occurred while placing your order.', paused })
        await sendEmail({ to: email, subject, html })
      }
      if (reason.toLowerCase().includes('session') || reason.toLowerCase().includes('auth')) invalidateOdooSession()
    }
  }

  return NextResponse.json(summary)
}

// Advance next_run_date (or end the schedule) after a successful/recovered run.
// Returns the new next_run_date (or null if ended).
async function advanceSchedule(
  supabase: ReturnType<typeof createServerClient>,
  s: ScheduledOrderRow,
  runDate: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  const next = nextRunDate({
    frequency: s.frequency, interval_weeks: s.interval_weeks,
    excluded_weekdays: s.excluded_weekdays, anchor_date: s.anchor_date, end_date: s.end_date,
  }, runDate)
  await supabase.from('scheduled_orders').update({
    ...(next ? { next_run_date: next } : { status: 'ended' }),
    last_run_at: new Date().toISOString(),
    ...extra,
  }).eq('id', s.id)
  return next
}

async function partnerEmail(
  sessionId: string,
  partnerId: number,
  callKw: (s: string, m: string, meth: string, a: unknown[], k?: Record<string, unknown>, o?: { scopeToCompany?: boolean }) => Promise<unknown>,
): Promise<string | null> {
  // Own-identity read: NOT company-scoped, since this partner may be sibling-owned and a
  // scoped read() would raise AccessError and kill the whole scheduled-order run.
  const rows = await callKw(sessionId, 'res.partner', 'read', [[partnerId]], { fields: ['email'] }, { scopeToCompany: false }) as { email: string | false }[]
  const email = rows[0]?.email
  return email && typeof email === 'string' ? email : null
}
