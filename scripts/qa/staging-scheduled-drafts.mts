// STAGING-ONLY write test for src/lib/odoo/scheduled-drafts.ts.
//
// Exercises the real module against a staging Odoo: creates upfront drafts for a synthetic
// schedule, proves findCart ignores them, confirms one on "its day" the way the executor
// does, checks the picking's scheduled_date lands on the delivery date, then cancels the
// rest the way pause/delete does.
//
//   ODOO_URL=... ODOO_DB=... ODOO_ADMIN_LOGIN=... ODOO_ADMIN_API_KEY=... ODOO_WEBSITE_ID=3 \
//   USE_MOCK_API=false npx tsx scripts/qa/staging-scheduled-drafts.mts
//
// Refuses to run against the production database.

import { getOdooSession } from '@/lib/odoo/admin-session'
import { callKw } from '@/lib/odoo/client'
import { findCart } from '@/lib/odoo/odoo-helpers'
import { todayBkk, addDays } from '@/lib/schedule-dates'
import {
  SCHED_HORIZON_DAYS, scheduleRunRef, runDatesBetween, findScheduledOrder,
  topUpScheduledDrafts, refreshDraftLines, alignPickingDates, cancelScheduledDrafts,
} from '@/lib/odoo/scheduled-drafts'

if (!/staging/i.test(process.env.ODOO_DB ?? '')) {
  console.error('REFUSING: ODOO_DB does not look like a staging database:', process.env.ODOO_DB)
  process.exit(2)
}

let pass = 0, fail = 0
const ok = (msg: string) => { pass++; console.log(`  PASS ${msg}`) }
const bad = (msg: string, detail?: unknown) => { fail++; console.log(`  FAIL ${msg}`); if (detail !== undefined) console.log('      ', detail) }
const check = (cond: boolean, msg: string, detail?: unknown) => cond ? ok(msg) : bad(msg, detail)

const PARTNER = 126 // "School" - exists on staging with the same id as production
const sched = {
  id: `qa${Date.now().toString(36)}-0000-0000-0000-000000000000`,
  partner_id: PARTNER, commercial_partner_id: PARTNER, shipping_address_id: PARTNER,
  po_ref: '', note: 'QA scheduled-drafts test', lang: 'en' as const,
  items: [{ product_id: 710, name: 'Sliced Bread Whole Wheat (Frozen)', name_he: '', sku: 'BAKF-0003', uom_qty: 5, packaging_id: 7783, packaging_qty: 1 }],
  frequency: 'daily' as const, interval_weeks: 1,
  excluded_weekdays: [0, 3, 6], // Sun, Wed, Sat - the customer's exact schedule
  anchor_date: todayBkk(), end_date: null,
}

const session = await getOdooSession()
const today = todayBkk()
const from = addDays(today, 1)
console.log(`\nA. run-date maths (today ${today}, horizon ${SCHED_HORIZON_DAYS}d)`)
const dates = runDatesBetween(sched, from, addDays(today, SCHED_HORIZON_DAYS))
check(dates.length > 0 && dates.length <= SCHED_HORIZON_DAYS, `${dates.length} run dates in the horizon`, dates)
check(dates.every(d => ![0, 3, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())), 'no excluded weekday in the run dates')
check(dates[0] > today, `first run ${dates[0]} is strictly after today`)

console.log('\nB. upfront drafts')
const made = await topUpScheduledDrafts(session, sched, from, today, PARTNER)
check(made.created === dates.length, `created ${made.created} draft(s) for ${dates.length} date(s)`)
const again = await topUpScheduledDrafts(session, sched, from, today, PARTNER)
check(again.created === 0, 'second top-up is idempotent (0 created)')

const drafts: { id: number; date: string }[] = []
for (const d of dates) {
  const o = await findScheduledOrder(session, sched.id, d)
  if (!o) { bad(`draft for ${d} not found`); continue }
  drafts.push({ id: o.id, date: d })
}
const rows = await callKw(session, 'sale.order', 'read', [drafts.map(d => d.id)], {
  fields: ['id', 'state', 'website_id', 'pricelist_id', 'commitment_date', 'client_order_ref', 'company_id', 'partner_shipping_id'],
}) as { id: number; state: string; website_id: unknown; pricelist_id: unknown; commitment_date: string; client_order_ref: string; company_id: [number, string]; partner_shipping_id: [number, string] }[]
check(rows.every(r => r.state === 'draft'), 'all are drafts')
check(rows.every(r => r.website_id === false), 'none carries website_id (so findCart ignores them)')
check(rows.every(r => r.company_id[0] === 1), 'all in company 1')
check(rows.every(r => r.commitment_date && drafts.some(d => r.commitment_date.startsWith(d.date))), 'each carries its run date as commitment_date')
check(rows.every(r => r.client_order_ref === scheduleRunRef(sched.id, r.commitment_date.slice(0, 10))), 'each carries the deterministic run ref')
const cart = await findCart(session, PARTNER)
check(!drafts.some(d => d.id === cart), `findCart does not adopt a draft (returned ${cart})`)

console.log('\nC. confirm one on its day, as the executor does')
const first = drafts[0]
await refreshDraftLines(session, first.id, sched.items)
const lines = await callKw(session, 'sale.order.line', 'search_read', [[['order_id', '=', first.id]]], { fields: ['product_id', 'product_uom_qty', 'price_unit'], limit: 0 }) as { product_uom_qty: number; price_unit: number }[]
check(lines.length === 1 && lines[0].product_uom_qty === 5, 'lines refreshed (1 line, qty 5)', lines)
check(lines[0].price_unit > 0, `Odoo priced the refreshed line (${lines[0].price_unit})`)
const { confirmSaleOrder } = await import('@/lib/odoo/confirm-order')
await confirmSaleOrder(session, first.id)
const aligned = await alignPickingDates(session, first.id)
const so = (await callKw(session, 'sale.order', 'read', [[first.id]], { fields: ['name', 'state', 'commitment_date', 'picking_ids'] }) as { name: string; state: string; commitment_date: string; picking_ids: number[] }[])[0]
check(so.state === 'sale', `${so.name} confirmed (state=${so.state})`)
check(aligned >= 1, `aligned ${aligned} picking(s)`)
const picks = await callKw(session, 'stock.picking', 'read', [so.picking_ids], { fields: ['name', 'scheduled_date', 'date_deadline', 'state'] }) as { name: string; scheduled_date: string; date_deadline: string; state: string }[]
for (const p of picks) {
  check(p.scheduled_date === so.commitment_date, `${p.name} scheduled_date == commitment_date (${p.scheduled_date})`, { scheduled: p.scheduled_date, commitment: so.commitment_date })
}

console.log('\nD. pause/delete withdraws the rest, leaves the confirmed one alone')
const cancelled = await cancelScheduledDrafts(session, sched.id, from)
check(cancelled === drafts.length - 1, `cancelled ${cancelled} of ${drafts.length - 1} remaining draft(s)`)
const after = await callKw(session, 'sale.order', 'read', [drafts.map(d => d.id)], { fields: ['id', 'state'] }) as { id: number; state: string }[]
check(after.find(r => r.id === first.id)?.state === 'sale', 'the confirmed order is untouched')
check(after.filter(r => r.id !== first.id).every(r => r.state === 'cancel'), 'every other draft is cancelled')
const cancelledAgain = await cancelScheduledDrafts(session, sched.id, from)
check(cancelledAgain === 0, 'cancel is idempotent (0 the second time)')

console.log(`\n================================================================\nPASS ${pass}   FAIL ${fail}`)
process.exit(fail ? 1 : 0)
