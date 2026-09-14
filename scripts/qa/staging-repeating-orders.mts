// STAGING-ONLY write test for the repeating-order window (src/lib/odoo/scheduled-window.ts).
//
//   ODOO_URL=... ODOO_DB=...staging... ODOO_ADMIN_LOGIN=... ODOO_ADMIN_API_KEY=... \
//   ODOO_WEBSITE_ID=3 USE_MOCK_API=false npx tsx scripts/qa/staging-repeating-orders.mts
//
// Refuses to run against a non-staging database.

import { getOdooSession } from '@/lib/odoo/admin-session'
import { callKw } from '@/lib/odoo/client'
import { findCart } from '@/lib/odoo/odoo-helpers'
import { todayBkk, addDays, weekdayOf, nextRunDate } from '@/lib/schedule-dates'
import { SCHED_WINDOW_DAYS } from '@/lib/scheduled-orders'
import {
  fillScheduleWindow, withdrawScheduleWindow, restoreScheduleWindow,
  scheduleRunRef, odooOrigin, odooNote, type ScheduleLike,
} from '@/lib/odoo/scheduled-window'

if (!/staging/i.test(process.env.ODOO_DB ?? '')) {
  console.error('REFUSING: ODOO_DB is not a staging database:', process.env.ODOO_DB); process.exit(2)
}

let pass = 0, fail = 0
const ok = (m: string) => { pass++; console.log(`  PASS ${m}`) }
const bad = (m: string, d?: unknown) => { fail++; console.log(`  FAIL ${m}`); if (d !== undefined) console.log('      ', d) }
const check = (c: boolean, m: string, d?: unknown) => c ? ok(m) : bad(m, d)

const PARTNER = 126 // School
const session = await getOdooSession()
const today = todayBkk()

// A DAILY schedule for Tue/Wed/Thu = exclude Sun,Mon,Fri,Sat. This is the exact case the
// customer hit (S18107).
const sched: ScheduleLike = {
  id: `qa${Date.now().toString(36)}00000000000000000000`.slice(0, 36),
  partner_id: PARTNER, commercial_partner_id: PARTNER, shipping_address_id: PARTNER,
  po_ref: '', note: 'QA repeating-order test',
  items: [{ product_id: 28179, name: '[BAK-0004] Long Bun', name_he: '', sku: 'BAK-0004', uom_qty: 5, packaging_id: 9334, packaging_qty: 1 }],
  frequency: 'daily', interval_weeks: 1, weekday: null,
  excluded_weekdays: [0, 1, 5, 6], anchor_date: today, end_date: null,
}
const first = nextRunDate({ ...sched, anchor_date: today }, today)!

console.log(`\nA. window is CONFIRMED orders, correct dates, no order today (today ${today})`)
const w = await fillScheduleWindow(session, sched, today, first, PARTNER)
const days = [...w.placed].map(o => o.date).sort()
check(w.placed.length >= 1, `${w.placed.length} orders placed`, days)
check(days.every(d => [2, 3, 4].includes(weekdayOf(d))), 'every order is a Tue/Wed/Thu', days)
check(days.every(d => d > today), 'no order dated today or earlier')
check(days.every(d => d <= addDays(today, SCHED_WINDOW_DAYS)), `all within the ${SCHED_WINDOW_DAYS}-day window`)

const ids = w.placed.map(o => o.id)
const rows = await callKw(session, 'sale.order', 'read', [ids], {
  fields: ['state', 'website_id', 'commitment_date', 'client_order_ref', 'origin', 'picking_ids', 'company_id'],
}) as { id: number; state: string; website_id: unknown; commitment_date: string; client_order_ref: string; origin: string; picking_ids: number[]; company_id: [number, string] }[]
check(rows.every(r => r.state === 'sale'), 'all CONFIRMED (state=sale)')
check(rows.every(r => r.website_id === false), 'none has website_id (findCart ignores them)')
check(rows.every(r => r.origin === odooOrigin(sched)), 'origin reads "Repeating order: every Tuesday, Wednesday, Thursday"', rows[0]?.origin)
check(rows.every(r => r.picking_ids.length > 0), 'each has a delivery (picking)')

console.log('\nB. each picking is scheduled for its delivery day (the warehouse fix)')
for (const r of rows) {
  const picks = await callKw(session, 'stock.picking', 'read', [r.picking_ids], { fields: ['scheduled_date', 'state'] }) as { scheduled_date: string; state: string }[]
  const open = picks.filter(p => p.state !== 'cancel')
  check(open.every(p => p.scheduled_date === r.commitment_date), `picking scheduled_date == delivery date for ${r.client_order_ref.slice(0, 20)}`, open.map(p => p.scheduled_date))
}

console.log('\nC. idempotent: a second fill places nothing new')
const w2 = await fillScheduleWindow(session, sched, today, first, PARTNER)
check(w2.placed.length === 0, '0 new orders on the second fill', w2.placed.map(o => o.date))
check(w2.existing.length === days.length, `all ${days.length} recognised as existing`)

console.log('\nD. a person cancels one day -> the fill never revives it')
const skipId = ids[1]
await callKw(session, 'sale.order', 'write', [[skipId], { locked: false }], {}) // a staff member clicks Unlock
await callKw(session, 'sale.order', 'action_cancel', [[skipId]], { context: { disable_cancel_warning: true } })
const w3 = await fillScheduleWindow(session, sched, today, first, PARTNER)
check(w3.placed.length === 0, 'still nothing re-created')
check(w3.skipped.some(o => o.id === skipId), 'the human-cancelled day is reported as skipped, not recreated')

console.log('\nE. pause withdraws the window; resume brings back exactly those')
const cancelled = await withdrawScheduleWindow(session, sched.id, addDays(today, 1), { paused: true })
check(cancelled >= 1, `${cancelled} order(s) cancelled by pause`)
const afterPause = await callKw(session, 'sale.order', 'read', [ids], { fields: ['id', 'state'] }) as { id: number; state: string }[]
check(afterPause.every(r => r.state === 'cancel'), 'every window order is now cancelled')
const restored = await restoreScheduleWindow(session, sched, today, first, PARTNER)
check(restored.revived >= 1, `resume revived ${restored.revived} paused order(s)`)
const afterResume = await callKw(session, 'sale.order', 'read', [ids], { fields: ['id', 'state', 'client_order_ref'] }) as { id: number; state: string; client_order_ref: string }[]
// the day a PERSON cancelled (skipId) must stay cancelled; the paused ones come back
check(afterResume.find(r => r.id === skipId)?.state === 'cancel', 'the human-cancelled day stayed cancelled after resume')
check(afterResume.filter(r => r.id !== skipId).some(r => r.state === 'sale'), 'paused days are confirmed again')
check(afterResume.every(r => !r.client_order_ref.includes('(paused)')), 'the (paused) tag is cleared on revived orders')

console.log('\nF. findCart still returns the real cart, never a scheduled order')
const cart = await findCart(session, PARTNER)
check(!ids.includes(cart as number), `findCart did not adopt a scheduled order (returned ${cart})`)

console.log('\nG. cleanup: withdraw everything')
await withdrawScheduleWindow(session, sched.id, addDays(today, 1), { paused: false })
const finalRows = await callKw(session, 'sale.order', 'read', [ids], { fields: ['state'] }) as { state: string }[]
check(finalRows.every(r => r.state === 'cancel'), 'all test orders left cancelled')

// show one order's note so a human can eyeball the wording
const note = odooNote(sched, first)
console.log('\n--- sample Odoo note on each order ---\n' + note + '\n')

console.log(`\n================================================================\nPASS ${pass}   FAIL ${fail}`)
process.exit(fail ? 1 : 0)
