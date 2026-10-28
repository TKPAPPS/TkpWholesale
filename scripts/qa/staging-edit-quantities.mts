// STAGING-ONLY write test for editing a repeating order's quantities
// (updateWindowQuantities + applyQuantityEdit).
//
//   ODOO_URL=... ODOO_DB=...staging... ODOO_ADMIN_LOGIN=... ODOO_ADMIN_API_KEY=... \
//   ODOO_WEBSITE_ID=3 USE_MOCK_API=false npx tsx scripts/qa/staging-edit-quantities.mts
//
// Refuses to run against a non-staging database.

import { getOdooSession } from '@/lib/odoo/admin-session'
import { callKw } from '@/lib/odoo/client'
import { todayBkk, addDays, nextRunDate } from '@/lib/schedule-dates'
import { applyQuantityEdit } from '@/lib/scheduled-orders'
import { fillScheduleWindow, withdrawScheduleWindow, updateWindowQuantities, type ScheduleLike } from '@/lib/odoo/scheduled-window'

if (!/staging/i.test(process.env.ODOO_DB ?? '')) {
  console.error('REFUSING: ODOO_DB is not a staging database:', process.env.ODOO_DB); process.exit(2)
}

let pass = 0, fail = 0
const check = (c: boolean, m: string, d?: unknown) => {
  if (c) { pass++; console.log(`  PASS ${m}`) } else { fail++; console.log(`  FAIL ${m}`); if (d !== undefined) console.log('      ', d) }
}

const PARTNER = 126
const session = await getOdooSession()
const today = todayBkk()
const sched: ScheduleLike = {
  id: `qb${Date.now().toString(36)}00000000000000000000`.slice(0, 36),
  partner_id: PARTNER, commercial_partner_id: PARTNER, shipping_address_id: PARTNER,
  po_ref: '', note: 'QA edit-quantities test',
  items: [{ product_id: 28179, name: '[BAK-0004] Long Bun', name_he: '', sku: 'BAK-0004', uom_qty: 5, packaging_id: 9334, packaging_qty: 1 }],
  frequency: 'daily', interval_weeks: 1, weekday: null,
  excluded_weekdays: [], anchor_date: today, end_date: null,
}
const first = nextRunDate({ ...sched }, today)!

console.log('\nA. applyQuantityEdit (pure)')
const e1 = applyQuantityEdit(sched.items, [{ product_id: 28179, qty: 3 }])
check(e1.ok && e1.items[0].packaging_qty === 3 && e1.items[0].uom_qty === 15, '3 packs of 5 -> uom_qty 15', e1)
for (const [name, bad] of [['zero', 0], ['negative', -2], ['fraction', 1.5], ['huge', 100000], ['string', '4']] as const) {
  check(!applyQuantityEdit(sched.items, [{ product_id: 28179, qty: bad }]).ok, `rejects ${name}`)
}
check(!applyQuantityEdit(sched.items, [{ product_id: 1, qty: 2 }]).ok, 'rejects a product that is not on the schedule')
check(!applyQuantityEdit(sched.items, []).ok, 'rejects a missing item')

console.log('\nB. the window is edited: lines, picking, open MO, lock')
const w = await fillScheduleWindow(session, sched, today, first, PARTNER)
const ids = w.placed.map(o => o.id)
check(ids.length >= 3, `${ids.length} orders placed`)
const newItems = (e1 as { items: typeof sched.items }).items
const r = await updateWindowQuantities(session, sched.id, newItems, addDays(today, 1))
check(r.updated.length === ids.length && r.failed.length === 0, `${r.updated.length} orders updated, ${r.failed.length} failed`, r)

const orders = await callKw(session, 'sale.order', 'read', [ids], { fields: ['name', 'locked', 'state', 'order_line', 'picking_ids'] }) as { id: number; name: string; locked: boolean; state: string; order_line: number[]; picking_ids: number[] }[]
for (const o of orders) {
  const lines = await callKw(session, 'sale.order.line', 'read', [o.order_line], { fields: ['product_uom_qty'] }) as { product_uom_qty: number }[]
  check(lines.length === 1 && lines[0].product_uom_qty === 15, `${o.name} line is 15`, lines)
  check(o.state === 'sale', `${o.name} still confirmed`)
  check(o.locked === true, `${o.name} locked again`)
  const moves = await callKw(session, 'stock.move', 'search_read', [[['picking_id', 'in', o.picking_ids]]], { fields: ['product_uom_qty', 'state'] }) as { product_uom_qty: number; state: string }[]
  check(moves.filter(m => m.state !== 'cancel').reduce((n, m) => n + m.product_uom_qty, 0) === 15, `${o.name} delivery moves total 15`, moves)
  const mos = await callKw(session, 'mrp.production', 'search_read', [[['origin', '=', o.name]]], { fields: ['name', 'product_qty', 'state'] }) as { name: string; product_qty: number; state: string }[]
  check(mos.filter(m => m.state !== 'cancel').reduce((n, m) => n + m.product_qty, 0) === 15, `${o.name} MOs total 15, not doubled (${mos.length} MO)`, mos)
}

console.log('\nC. idempotent and scoped')
const r2 = await updateWindowQuantities(session, sched.id, newItems, addDays(today, 1))
check(r2.updated.length === 0, 'second run changes nothing')
const r3 = await updateWindowQuantities(session, sched.id, newItems, addDays(today, 100))
check(r3.updated.length === 0, 'orders before the cut-off day are not touched')

console.log('\nD. decrease: 15 -> 2 packs of 5 = 10, then 1 pack = 5')
for (const packs of [2, 1]) {
  const ei = applyQuantityEdit(sched.items, [{ product_id: 28179, qty: packs }]) as { items: typeof sched.items }
  const rd = await updateWindowQuantities(session, sched.id, ei.items, addDays(today, 1))
  check(rd.updated.length === ids.length && rd.failed.length === 0 && rd.mosLeft.length === 0, `${packs} pack(s): all orders updated`, rd)
  const ls = await callKw(session, 'sale.order.line', 'search_read', [[['order_id', 'in', ids]]], { fields: ['product_uom_qty'] }) as { product_uom_qty: number }[]
  check(ls.every(l => l.product_uom_qty === 5 * packs), `lines are ${5 * packs}`, ls)
  for (const o of orders) {
    const mos = await callKw(session, 'mrp.production', 'search_read', [[['origin', '=', o.name]]], { fields: ['product_qty', 'state'] }) as { product_qty: number; state: string }[]
    check(mos.filter(m => m.state !== 'cancel').reduce((n, m) => n + m.product_qty, 0) === 5 * packs, `${o.name} MOs total ${5 * packs}`, mos)
  }
}

console.log('\nE. cleanup')
await withdrawScheduleWindow(session, sched.id, addDays(today, 1), { paused: false })
const fin = await callKw(session, 'sale.order', 'read', [ids], { fields: ['state'] }) as { state: string }[]
check(fin.every(x => x.state === 'cancel'), 'all test orders left cancelled')

console.log(`\n================================================================\nPASS ${pass}   FAIL ${fail}`)
process.exit(fail ? 1 : 0)
