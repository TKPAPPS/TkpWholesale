import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { scheduleConfigured, updateOwnedSchedule } from '@/lib/scheduled-orders-db'
import { todayBkk, nextRunDate } from '@/lib/schedule-dates'
import { createServerClient } from '@/lib/supabase'
import type { ScheduledOrderRow } from '@/lib/scheduled-orders-db'
import { readJsonObject } from '@/lib/request-body'
import { getOdooSession } from '@/lib/odoo/admin-session'
import { cancelScheduledDrafts, topUpScheduledDrafts } from '@/lib/odoo/scheduled-drafts'

// Upcoming orders live in Odoo as drafts ahead of time (scheduled-drafts.ts), so every
// state change here has to be mirrored there: pausing/ending/deleting cancels the
// outstanding drafts, resuming re-creates them. Best effort - the schedule row is the
// source of truth and the executor reconciles drafts each morning regardless.
async function withdrawDrafts(scheduleId: string) {
  try {
    const sessionId = await getOdooSession()
    const n = await cancelScheduledDrafts(sessionId, scheduleId, todayBkk())
    if (n) console.log(`scheduled-orders: cancelled ${n} upcoming draft(s) for ${scheduleId.slice(0, 8)}`)
  } catch (err) {
    console.error('withdrawDrafts failed (schedule state still updated):', err)
  }
}

export const dynamic = 'force-dynamic'

// PATCH: pause / resume, or update the end date. DELETE: soft-cancel.
// Ownership is enforced in the WHERE clause (commercial_partner_id), so a request
// for another customer's schedule matches 0 rows → 404.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })
  if (!scheduleConfigured()) return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })

  const body = await readJsonObject(req)
  const action = body.action as string | undefined

  try {
    if (action === 'pause') {
      const ok = await updateOwnedSchedule(params.id, parsed.commercial_partner_id, {
        status: 'paused', paused_reason: 'user',
      })
      if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
      await withdrawDrafts(params.id)
      return NextResponse.json({ ok: true })
    }

    if (action === 'resume') {
      // Recompute next_run_date from today so a long pause doesn't fire a backlog,
      // and clear the failure counter. Read the row first (owned) to get the spec.
      const supabase = createServerClient()
      const { data } = await supabase
        .from('scheduled_orders')
        .select('*')
        .eq('id', params.id)
        .eq('commercial_partner_id', parsed.commercial_partner_id)
        .single()
      const row = data as ScheduledOrderRow | null
      if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

      const today = todayBkk()
      const next = nextRunDate({
        frequency: row.frequency, interval_weeks: row.interval_weeks,
        excluded_weekdays: row.excluded_weekdays, anchor_date: row.anchor_date, end_date: row.end_date,
      }, today)
      if (!next) {
        await updateOwnedSchedule(params.id, parsed.commercial_partner_id, { status: 'ended', paused_reason: null })
        await withdrawDrafts(params.id)
        return NextResponse.json({ ok: true, status: 'ended' })
      }
      await updateOwnedSchedule(params.id, parsed.commercial_partner_id, {
        status: 'active', paused_reason: null, consecutive_failures: 0, next_run_date: next,
      })
      try {
        const sessionId = await getOdooSession()
        await topUpScheduledDrafts(sessionId, row, next, today, row.shipping_address_id)
      } catch (err) {
        console.error('resume: draft top-up failed (schedule still active):', err)
      }
      return NextResponse.json({ ok: true, status: 'active', next_run_date: next })
    }

    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  } catch (err) {
    console.error('scheduled-order PATCH error:', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })
  if (!scheduleConfigured()) return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })

  try {
    const ok = await updateOwnedSchedule(params.id, parsed.commercial_partner_id, { status: 'cancelled' })
    if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    await withdrawDrafts(params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('scheduled-order DELETE error:', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 503 })
  }
}
