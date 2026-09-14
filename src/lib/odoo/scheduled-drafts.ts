import { callKw } from '@/lib/odoo/client'
import { nextRunDate, addDays, isAfter, type RecurrenceSpec } from '@/lib/schedule-dates'
import type { ScheduledOrderItem } from '@/lib/scheduled-orders'

// Upcoming scheduled orders exist in Odoo AHEAD of time, as draft quotations.
//
// Why: the original executor created each order on the morning it was due, so nothing
// about a repeating order was visible in Odoo until it landed. The office could not see
// what was coming, the warehouse could not plan, and the customer's own immediate
// checkout order plus the scheduler's first run produced duplicates on day one
// (S18088 for 15/09 AND a scheduled order for 15/09). Reported 2026-09-14.
//
// Why DRAFTS and not confirmed orders: R4 reserves stock at confirm
// (`reservation_method = at_confirm`). Confirming a fortnight of daily bread today would
// reserve all of it now, `free_qty` would collapse, and the portal would hide the product
// from every other customer - the overselling protection working against us. A draft
// reserves nothing. It is confirmed by the executor on the morning it is due, at which
// point its lines are re-created so Odoo prices them at that day's live pricelist.
//
// Why a rolling HORIZON and not "all of them": "End date (optional)" means a schedule can
// be open-ended, so there is no last order to create. Drafts are kept topped up to
// SCHED_HORIZON_DAYS ahead, by the executor each morning and by any schedule change.
//
// Why findCart cannot mistake a draft for the customer's cart: it filters on
// `website_id = WEBSITE_ID`, and these drafts are created without one. Same reason the
// executor never set it.

export const SCHED_HORIZON_DAYS = 14

const COMPANY_ID = 1

export interface ScheduleLike {
  id: string
  partner_id: number
  commercial_partner_id: number
  shipping_address_id: number
  po_ref: string
  note: string
  items: ScheduledOrderItem[]
  frequency: 'daily' | 'weekly'
  interval_weeks: number
  excluded_weekdays: number[]
  anchor_date: string
  end_date: string | null
}

// Deterministic per-run reference. Same shape the executor has always used, so the
// recovery check for a crash-after-confirm keeps working unchanged.
export function scheduleRunRef(scheduleId: string, runDate: string): string {
  return `AUTO:${scheduleId.slice(0, 8)}:${runDate}`
}

function specOf(s: ScheduleLike): RecurrenceSpec {
  return {
    frequency: s.frequency,
    interval_weeks: s.interval_weeks,
    excluded_weekdays: s.excluded_weekdays,
    anchor_date: s.anchor_date,
    end_date: s.end_date,
  }
}

// Every run date of a schedule from `from` (inclusive) up to and including `until`.
export function runDatesBetween(s: ScheduleLike, from: string, until: string): string[] {
  const out: string[] = []
  const spec = specOf(s)
  // nextRunDate is "strictly after", so step from the day before `from`.
  let d: string | null = nextRunDate(spec, addDays(from, -1))
  let guard = 0
  while (d && !isAfter(d, until)) {
    out.push(d)
    d = nextRunDate(spec, d)
    if (++guard > 400) break
  }
  return out
}

export async function findScheduledOrder(
  sessionId: string, scheduleId: string, runDate: string,
): Promise<{ id: number; name: string; state: string } | null> {
  const ref = scheduleRunRef(scheduleId, runDate)
  const rows = await callKw(sessionId, 'sale.order', 'search_read', [[
    ['client_order_ref', 'like', ref],
    ['company_id', '=', COMPANY_ID],
  ]], { fields: ['id', 'name', 'state'], limit: 1, order: 'id desc' }) as { id: number; name: string; state: string }[]
  return rows[0] ?? null
}

// 09:00 Bangkok, expressed in UTC, on the run date. What the customer sees as the
// delivery date and what the picking's scheduled_date is aligned to after confirm.
function commitmentUtc(runDate: string): string {
  return `${runDate} 02:00:00`
}

function lineVals(orderId: number, items: ScheduledOrderItem[]) {
  // No price_unit - Odoo computes the pricelist price.
  return items.map(i => ({
    order_id: orderId,
    product_id: i.product_id,
    product_uom_qty: i.uom_qty,
    ...(i.packaging_id ? { product_packaging_id: i.packaging_id, product_packaging_qty: i.packaging_qty } : {}),
  }))
}

// Create the draft for one run date. Idempotent on the run ref: if any order already
// carries it (draft, confirmed, or cancelled) nothing is created.
export async function createScheduledDraft(
  sessionId: string, s: ScheduleLike, runDate: string, shippingId: number,
): Promise<{ id: number; created: boolean }> {
  const existing = await findScheduledOrder(sessionId, s.id, runDate)
  if (existing) return { id: existing.id, created: false }

  const ref = scheduleRunRef(s.id, runDate)
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const orderId = await callKw(sessionId, 'sale.order', 'create', [{
    partner_id: s.partner_id,
    // No website_id (findCart would adopt it as a cart) and no pricelist_id (Odoo
    // derives it), so company must be explicit.
    company_id: COMPANY_ID,
    partner_shipping_id: shippingId,
    client_order_ref: s.po_ref ? `${ref} (${s.po_ref})` : ref,
    origin: `Portal scheduled order ${s.id.slice(0, 8)}`,
    note: s.note || '',
    date_order: nowUtc,
    commitment_date: commitmentUtc(runDate),
  }], {}) as number
  await callKw(sessionId, 'sale.order.line', 'create', [lineVals(orderId, s.items)], {})
  return { id: orderId, created: true }
}

// Make sure a draft exists for every run date from `from` through today + horizon.
// Best effort per date: one failure does not stop the others.
export async function topUpScheduledDrafts(
  sessionId: string, s: ScheduleLike, from: string, today: string, shippingId: number,
): Promise<{ created: number; dates: string[] }> {
  const until = addDays(today, SCHED_HORIZON_DAYS)
  const dates = runDatesBetween(s, from, until)
  let created = 0
  for (const d of dates) {
    try {
      const r = await createScheduledDraft(sessionId, s, d, shippingId)
      if (r.created) created++
    } catch (err) {
      console.warn(`scheduled-drafts: could not create draft for ${s.id.slice(0, 8)} on ${d}:`, err)
    }
  }
  return { created, dates }
}

// Cancel every still-draft future order for a schedule from `from` onward. Used when a
// schedule is paused, edited, ended or deleted. Confirmed orders are left alone - those
// are real orders now.
export async function cancelScheduledDrafts(
  sessionId: string, scheduleId: string, from: string,
): Promise<number> {
  const prefix = `AUTO:${scheduleId.slice(0, 8)}:`
  const rows = await callKw(sessionId, 'sale.order', 'search_read', [[
    ['client_order_ref', 'like', prefix],
    ['company_id', '=', COMPANY_ID],
    ['state', '=', 'draft'],
    ['commitment_date', '>=', commitmentUtc(from)],
  ]], { fields: ['id'], limit: 0 }) as { id: number }[]
  if (rows.length === 0) return 0
  await callKw(sessionId, 'sale.order', 'action_cancel', [rows.map(r => r.id)], {})
  return rows.length
}

// Re-create a draft's lines immediately before confirming it, so Odoo prices them at
// today's pricelist rather than whatever it was on the day the draft was made. The
// header (partner, address, ref, delivery date) is kept.
export async function refreshDraftLines(
  sessionId: string, orderId: number, items: ScheduledOrderItem[],
): Promise<void> {
  const old = await callKw(sessionId, 'sale.order.line', 'search_read',
    [[['order_id', '=', orderId]]], { fields: ['id'], limit: 0 }) as { id: number }[]
  if (old.length) await callKw(sessionId, 'sale.order.line', 'unlink', [old.map(l => l.id)], {})
  await callKw(sessionId, 'sale.order.line', 'create', [lineVals(orderId, items)], {})
}

// After confirm, make the picking's scheduled_date match the order's delivery date.
//
// Odoo copies commitment_date into the picking's date_deadline but leaves its
// scheduled_date at the order time, and scheduled_date is the prominent one the
// warehouse works from. S18090 was for delivery 17/09 and R4 shipped it at 11:30 on
// 14/09, because R4/OUT/16460 showed "Scheduled Date 14/09 11:14". Writing
// scheduled_date on the picking propagates to its moves.
export async function alignPickingDates(sessionId: string, orderId: number): Promise<number> {
  const so = (await callKw(sessionId, 'sale.order', 'read', [[orderId]], {
    fields: ['commitment_date', 'picking_ids'],
  }) as { commitment_date: string | false; picking_ids: number[] }[])[0]
  if (!so || !so.commitment_date || !so.picking_ids?.length) return 0

  const picks = await callKw(sessionId, 'stock.picking', 'read', [so.picking_ids], {
    fields: ['id', 'state', 'scheduled_date'],
  }) as { id: number; state: string; scheduled_date: string }[]
  const open = picks.filter(p => p.state !== 'done' && p.state !== 'cancel')
  if (open.length === 0) return 0
  await callKw(sessionId, 'stock.picking', 'write', [open.map(p => p.id), {
    scheduled_date: so.commitment_date,
  }], {})
  return open.length
}
