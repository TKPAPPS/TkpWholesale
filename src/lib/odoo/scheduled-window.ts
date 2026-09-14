import { callKw } from '@/lib/odoo/client'
import { nextRunDate, addDays, isAfter, type RecurrenceSpec } from '@/lib/schedule-dates'
import { cadenceLabel, humanDate, SCHED_WINDOW_DAYS, type ScheduledOrderItem } from '@/lib/scheduled-orders'

// A repeating order keeps a rolling window of CONFIRMED sale orders in Odoo.
//
// The contract, stated to customers and staff in the same words everywhere:
//   "The next 7 days of orders are already in the system as confirmed orders. Each morning
//    at 06:30 the following day's order is added."
//
// Why CONFIRMED, not drafts: a draft creates no picking, and the warehouse plans from
// pickings. Drafts gave the office visibility while leaving R4 exactly as blind as before.
// A confirmed order gets a picking dated for its delivery day, which is the thing R4
// actually looks at.
//
// Why a 7-day window and not everything: "End date (optional)" means a schedule can be
// open-ended, so there is no last order to create; and Odoo reserves stock at confirm, so
// the window bounds how far ahead stock is committed. The window is topped up daily.
//
// Why findCart cannot mistake one for the customer's cart: it filters on
// `website_id = WEBSITE_ID`, and these orders are created without one.
//
// Human override: cancelling one of these orders in Odoo means "skip that day". The
// portal never revives an order a person cancelled. Pause in the portal cancels the
// window too, but tags the ref with " (paused)" so Resume knows which ones it may bring
// back.

const COMPANY_ID = 1
const PAUSED_TAG = ' (paused)'

// A confirmed sale order auto-locks in this Odoo, and a locked order refuses action_cancel /
// action_draft ("You cannot cancel a locked order"). Unlock first. Safe on an unlocked or
// draft order (it just clears the flag), and best-effort so a build without the field is fine.
async function unlock(sessionId: string, ids: number[]): Promise<void> {
  if (!ids.length) return
  try { await callKw(sessionId, 'sale.order', 'write', [ids, { locked: false }], {}) }
  catch { /* older Odoo used action_unlock; fall through */ }
  try { await callKw(sessionId, 'sale.order', 'action_unlock', [ids], {}) } catch { /* not present */ }
}

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
  weekday?: number | null
  excluded_weekdays: number[]
  anchor_date: string
  end_date: string | null
}

export function scheduleRunRef(scheduleId: string, runDate: string): string {
  return `AUTO:${scheduleId.slice(0, 8)}:${runDate}`
}

function specOf(s: ScheduleLike): RecurrenceSpec {
  return {
    frequency: s.frequency, interval_weeks: s.interval_weeks,
    excluded_weekdays: s.excluded_weekdays, anchor_date: s.anchor_date, end_date: s.end_date,
  }
}

// Every run date from `from` (inclusive) to `until` (inclusive).
export function runDatesBetween(s: ScheduleLike, from: string, until: string): string[] {
  const out: string[] = []
  let d: string | null = nextRunDate(specOf(s), addDays(from, -1))
  let guard = 0
  while (d && !isAfter(d, until)) {
    out.push(d)
    d = nextRunDate(specOf(s), d)
    if (++guard > 400) break
  }
  return out
}

// The dates the window should hold: strictly after today, up to today + window, and never
// before `floor` (the schedule's next_run_date, which a manual re-seed may have pushed out
// so the window does not duplicate an order the customer placed by hand).
export function windowDates(s: ScheduleLike, today: string, floor: string): string[] {
  const start = isAfter(floor, today) ? floor : addDays(today, 1)
  return runDatesBetween(s, start, addDays(today, SCHED_WINDOW_DAYS))
}

export interface ScheduledOrderRef { id: number; name: string; state: string; client_order_ref: string }

export async function findScheduledOrder(sessionId: string, scheduleId: string, runDate: string): Promise<ScheduledOrderRef | null> {
  const rows = await callKw(sessionId, 'sale.order', 'search_read', [[
    ['client_order_ref', 'like', scheduleRunRef(scheduleId, runDate)],
    ['company_id', '=', COMPANY_ID],
  ]], { fields: ['id', 'name', 'state', 'client_order_ref'], limit: 1, order: 'id desc', context: { active_test: false } }) as ScheduledOrderRef[]
  return rows[0] ?? null
}

function commitmentUtc(runDate: string): string {
  return `${runDate} 02:00:00` // 09:00 Bangkok
}

function lineVals(orderId: number, items: ScheduledOrderItem[]) {
  return items.map(i => ({
    order_id: orderId,
    product_id: i.product_id,
    product_uom_qty: i.uom_qty,
    ...(i.packaging_id ? { product_packaging_id: i.packaging_id, product_packaging_qty: i.packaging_qty } : {}),
  }))
}

// What Odoo staff read on the order. English, since that is the back office language.
export function odooOrigin(s: ScheduleLike): string {
  return `Repeating order: ${cadenceLabel(s, 'en').toLowerCase()}`
}
export function odooNote(s: ScheduleLike, runDate: string): string {
  return [
    `Part of a repeating order (${cadenceLabel(s, 'en').toLowerCase()}) placed through the wholesale portal.`,
    `This order is for ${humanDate(runDate, 'en')}.`,
    `The next ${SCHED_WINDOW_DAYS} days of this customer's repeating order are always in the system as confirmed orders; each morning at 06:30 the following day is added automatically.`,
    `To skip this day: cancel this order. The portal will not recreate it.`,
    s.note ? `Customer note: ${s.note}` : '',
  ].filter(Boolean).join('\n')
}

// After confirm, put the picking's scheduled_date on the delivery day. Odoo copies
// commitment_date into date_deadline but leaves scheduled_date at the order time, and
// scheduled_date is what R4 works from (S18090: due 17/09, shipped 14/09).
export async function alignPickingDates(sessionId: string, orderId: number): Promise<number> {
  const so = (await callKw(sessionId, 'sale.order', 'read', [[orderId]], { fields: ['commitment_date', 'picking_ids'] }) as { commitment_date: string | false; picking_ids: number[] }[])[0]
  if (!so?.commitment_date || !so.picking_ids?.length) return 0
  const picks = await callKw(sessionId, 'stock.picking', 'read', [so.picking_ids], { fields: ['id', 'state'] }) as { id: number; state: string }[]
  const open = picks.filter(p => p.state !== 'done' && p.state !== 'cancel')
  if (!open.length) return 0
  await callKw(sessionId, 'stock.picking', 'write', [open.map(p => p.id), { scheduled_date: so.commitment_date }], {})
  return open.length
}

// Create AND confirm the order for one run date. Idempotent on the run ref: if any order
// already carries it - confirmed, done, or cancelled by a person - nothing is created.
export async function placeScheduledOrder(
  sessionId: string, s: ScheduleLike, runDate: string, shippingId: number,
): Promise<{ id: number; name: string; state: string; created: boolean }> {
  const existing = await findScheduledOrder(sessionId, s.id, runDate)
  if (existing) return { id: existing.id, name: existing.name, state: existing.state, created: false }

  const ref = scheduleRunRef(s.id, runDate)
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const orderId = await callKw(sessionId, 'sale.order', 'create', [{
    partner_id: s.partner_id,
    company_id: COMPANY_ID,            // explicit: no website_id, no pricelist_id
    partner_shipping_id: shippingId,
    client_order_ref: s.po_ref ? `${ref} (${s.po_ref})` : ref,
    origin: odooOrigin(s),
    note: odooNote(s, runDate),
    date_order: nowUtc,
    commitment_date: commitmentUtc(runDate),
  }], {}) as number
  await callKw(sessionId, 'sale.order.line', 'create', [lineVals(orderId, s.items)], {})

  // Same unscoped confirm as checkout: a sister-company customer raises an inter-company PO.
  const { confirmSaleOrder } = await import('@/lib/odoo/confirm-order')
  await confirmSaleOrder(sessionId, orderId)
  await alignPickingDates(sessionId, orderId)

  const row = (await callKw(sessionId, 'sale.order', 'read', [[orderId]], { fields: ['name', 'state'] }) as { name: string; state: string }[])[0]
  return { id: orderId, name: row.name, state: row.state, created: true }
}

export interface WindowResult {
  placed: { date: string; id: number; name: string }[]     // created + confirmed this call
  existing: { date: string; id: number; name: string }[]   // already there, confirmed
  skipped: { date: string; id: number; name: string }[]    // cancelled by a person: left alone
  failed: { date: string; error: string }[]
}

// Bring the window up to date: one confirmed order per run date, nothing created for a
// date a person has cancelled. Best effort per date.
export async function fillScheduleWindow(
  sessionId: string, s: ScheduleLike, today: string, floor: string, shippingId: number,
): Promise<WindowResult> {
  const res: WindowResult = { placed: [], existing: [], skipped: [], failed: [] }
  for (const date of windowDates(s, today, floor)) {
    try {
      const r = await placeScheduledOrder(sessionId, s, date, shippingId)
      const entry = { date, id: r.id, name: r.name }
      if (r.created) res.placed.push(entry)
      else if (r.state === 'cancel') res.skipped.push(entry)
      else res.existing.push(entry)
    } catch (err) {
      res.failed.push({ date, error: err instanceof Error ? err.message : String(err) })
      console.warn(`scheduled-window: ${s.id.slice(0, 8)} ${date} failed:`, err)
    }
  }
  return res
}

// Pause / end / delete: cancel every not-yet-delivered scheduled order from `from` on.
// `paused` tags the ref so Resume can tell these apart from orders a person cancelled.
export async function withdrawScheduleWindow(
  sessionId: string, scheduleId: string, from: string, opts: { paused: boolean },
): Promise<number> {
  const prefix = `AUTO:${scheduleId.slice(0, 8)}:`
  const rows = await callKw(sessionId, 'sale.order', 'search_read', [[
    ['client_order_ref', 'like', prefix],
    ['company_id', '=', COMPANY_ID],
    ['state', 'in', ['draft', 'sent', 'sale']],
    ['commitment_date', '>=', commitmentUtc(from)],
  ]], { fields: ['id', 'client_order_ref'], limit: 0 }) as { id: number; client_order_ref: string }[]
  if (!rows.length) return 0
  const ids = rows.map(r => r.id)
  await unlock(sessionId, ids)
  // disable_cancel_warning: skip the "send cancellation email?" wizard a confirmed order can raise.
  await callKw(sessionId, 'sale.order', 'action_cancel', [ids], { context: { disable_cancel_warning: true } })
  if (opts.paused) {
    for (const r of rows) {
      if (!r.client_order_ref.includes(PAUSED_TAG)) {
        await callKw(sessionId, 'sale.order', 'write', [[r.id], { client_order_ref: r.client_order_ref + PAUSED_TAG }], {})
      }
    }
  }
  return ids.length
}

// Resume: bring back the orders Pause cancelled (and only those), then fill the window.
export async function restoreScheduleWindow(
  sessionId: string, s: ScheduleLike, today: string, floor: string, shippingId: number,
): Promise<WindowResult & { revived: number }> {
  const prefix = `AUTO:${s.id.slice(0, 8)}:`
  const paused = await callKw(sessionId, 'sale.order', 'search_read', [[
    ['client_order_ref', 'like', prefix],
    ['client_order_ref', 'like', PAUSED_TAG],
    ['company_id', '=', COMPANY_ID],
    ['state', '=', 'cancel'],
    ['commitment_date', '>=', commitmentUtc(addDays(today, 1))],
  ]], { fields: ['id', 'client_order_ref'], limit: 0 }) as { id: number; client_order_ref: string }[]
  let revived = 0
  const { confirmSaleOrder } = await import('@/lib/odoo/confirm-order')
  for (const r of paused) {
    try {
      await unlock(sessionId, [r.id])
      await callKw(sessionId, 'sale.order', 'action_draft', [[r.id]], {})
      await callKw(sessionId, 'sale.order', 'write', [[r.id], { client_order_ref: r.client_order_ref.replace(PAUSED_TAG, '') }], {})
      await confirmSaleOrder(sessionId, r.id)
      await alignPickingDates(sessionId, r.id)
      revived++
    } catch (err) {
      console.warn(`scheduled-window: revive ${r.id} failed:`, err)
    }
  }
  const filled = await fillScheduleWindow(sessionId, s, today, floor, shippingId)
  return { ...filled, revived }
}
