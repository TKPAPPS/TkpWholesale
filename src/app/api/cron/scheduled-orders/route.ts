import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { todayBkk, nextRunDate } from '@/lib/schedule-dates'
import { AUTO_PAUSE_AFTER_FAILURES, cadenceLabel, humanDate } from '@/lib/scheduled-orders'
import { sendEmail, scheduledPlacedEmail, scheduledFailedEmail } from '@/lib/email'
import type { ScheduledOrderRow } from '@/lib/scheduled-orders-db'
import { fillScheduleWindow, type ScheduleLike } from '@/lib/odoo/scheduled-window'

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

  // Every active schedule is processed each morning, not only the ones "due today": the job
  // keeps each schedule's rolling window of confirmed orders topped up. Order idempotency is
  // by deterministic client_order_ref, so re-processing a schedule places nothing new.
  const { data, error } = await supabase
    .from('scheduled_orders')
    .select('*')
    .eq('status', 'active')
    .order('next_run_date', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('cron: active query failed:', error.message)
    return NextResponse.json({ error: 'QUERY_FAILED' }, { status: 503 })
  }

  const active = (data ?? []) as ScheduledOrderRow[]
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

  for (const s of active) {
    summary.processed++

    // Once-per-day guard: stamp last_run_date. Empty result = another run today already did.
    const { data: claimed } = await supabase.rpc('touch_scheduled_order_run', { p_id: s.id, p_today: today })
    if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
      summary.skipped++
      continue
    }

    try {
      // Re-validate the delivery address; fall back to the commercial partner's own.
      const addresses = await fetchDeliveryAddresses(sessionId, s.commercial_partner_id)
      let shippingId = s.shipping_address_id
      let addressSubstituted = false
      if (!addresses.find(a => a.id === shippingId)) {
        const fallback = addresses.find(a => a.id === s.commercial_partner_id) ?? addresses[0]
        if (!fallback) throw new Error('No valid delivery address')
        shippingId = fallback.id
        addressSubstituted = true
      }

      const schedLike: ScheduleLike = {
        id: s.id, partner_id: s.partner_id, commercial_partner_id: s.commercial_partner_id,
        shipping_address_id: shippingId, po_ref: s.po_ref, note: s.note, items: s.items,
        frequency: s.frequency, interval_weeks: s.interval_weeks, weekday: s.weekday,
        excluded_weekdays: s.excluded_weekdays, anchor_date: s.anchor_date, end_date: s.end_date,
      }

      // Fill the window from whichever is later: today+1, or next_run_date. Orders whose day
      // has passed are simply no longer in the window (they were placed on a prior run and
      // have shipped or are in the warehouse), so next_run_date is advanced to the first
      // window date so the schedule row keeps tracking "the next order".
      const result = await fillScheduleWindow(sessionId, schedLike, today, s.next_run_date, shippingId)

      // Advance next_run_date to the earliest order still in the window (or, if the window is
      // empty because the schedule has ended, end it).
      const earliest = [...result.placed, ...result.existing]
        .map(o => o.date).sort()[0] ?? null
      const nextRun = earliest ?? nextRunDate({
        frequency: s.frequency, interval_weeks: s.interval_weeks,
        excluded_weekdays: s.excluded_weekdays, anchor_date: s.anchor_date, end_date: s.end_date,
      }, today)

      await supabase.from('scheduled_orders').update({
        ...(nextRun ? { next_run_date: nextRun } : { status: 'ended' }),
        last_run_at: new Date().toISOString(),
        last_status: 'success',
        consecutive_failures: 0,
        last_error: null,
        ...(result.placed.length ? { last_order_name: result.placed[result.placed.length - 1].name, last_order_id: result.placed[result.placed.length - 1].id } : {}),
      }).eq('id', s.id)

      if (result.failed.length) summary.failed += result.failed.length
      summary.placed += result.placed.length

      // Email only when at least one NEW order was placed this morning (the day's fresh one).
      if (result.placed.length) {
        const email = await partnerEmail(sessionId, s.partner_id, callKw)
        if (email) {
          const newest = result.placed.sort((a, b) => a.date.localeCompare(b.date))[0]
          const { subject, html } = scheduledPlacedEmail({
            lang: s.lang, orderName: newest.name, runDate: newest.date,
            items: s.items.map(i => ({ label: s.lang === 'he' ? i.name_he : i.name, qty: i.packaging_qty || i.uom_qty })),
            total: '', nextRunDate: nextRun, orderId: newest.id, addressSubstituted,
          })
          await sendEmail({ to: email, subject, html })
        }
      }
    } catch (err) {
      summary.failed++
      const reason = err instanceof Error ? err.message : 'Unknown error'
      console.error(`cron: schedule ${s.id} failed:`, reason)
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
        const { subject, html } = scheduledFailedEmail({ lang: s.lang, runDate: today, reason: 'A problem occurred while placing your order.', paused })
        await sendEmail({ to: email, subject, html })
      }
      if (reason.toLowerCase().includes('session') || reason.toLowerCase().includes('auth')) invalidateOdooSession()
    }
  }

  return NextResponse.json(summary)
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
