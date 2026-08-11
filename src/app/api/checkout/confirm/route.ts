import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { checkRateLimit } from '@/lib/rate-limit'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'
import { stripHtml } from '@/lib/text'
import { todayBkk, nextRunDate } from '@/lib/schedule-dates'
import { normalizeScheduleInput, MAX_ACTIVE_SCHEDULES } from '@/lib/scheduled-orders'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

// Build + persist a schedule from the just-confirmed order. Throws on any problem
// (Supabase not configured, over the per-customer cap, empty snapshot, or a
// schedule that would never run) so the caller can flag schedule_error.
async function createSchedule(args: {
  sessionId: string
  orderId: number
  spec: { frequency: 'daily' | 'weekly'; interval_weeks: number; excluded_weekdays: number[]; end_date: string | null }
  partnerId: number
  commercialPartnerId: number
  shippingAddressId: number
  poRef: string
  note: string
  lang: 'en' | 'he'
}): Promise<string> {
  const { readOrderItemsForSchedule } = await import('@/lib/odoo/odoo-helpers')
  const { scheduleConfigured, countActiveSchedules, insertSchedule } = await import('@/lib/scheduled-orders-db')

  if (!scheduleConfigured()) throw new Error('Scheduling backend not configured')

  const active = await countActiveSchedules(args.commercialPartnerId)
  if (active >= MAX_ACTIVE_SCHEDULES) throw new Error('Too many active schedules')

  const items = await readOrderItemsForSchedule(args.sessionId, args.orderId)
  if (items.length === 0) throw new Error('No schedulable items on the order')

  const anchor = todayBkk()
  const next = nextRunDate({ ...args.spec, anchor_date: anchor }, anchor)
  if (!next) throw new Error('Schedule would never run')

  return insertSchedule({
    partner_id: args.partnerId,
    commercial_partner_id: args.commercialPartnerId,
    shipping_address_id: args.shippingAddressId,
    po_ref: args.poRef,
    note: args.note,
    lang: args.lang,
    items,
    frequency: args.spec.frequency,
    interval_weeks: args.spec.interval_weeks,
    excluded_weekdays: args.spec.excluded_weekdays,
    anchor_date: anchor,
    end_date: args.spec.end_date,
    next_run_date: next,
    status: 'active',
  })
}

// Odoo business rejections (UserError: credit limit, blocked customer, etc.) are
// short human-readable sentences worth showing verbatim. Anything that looks like
// a server error (tracebacks, internal model/field names, walls of text) must not
// reach a customer; show a generic message instead.
function sanitizeOdooMessage(msg: string): string {
  const generic = 'Your order could not be confirmed. Please contact your sales representative.'
  if (!msg || msg.length > 300) return generic
  if (/Traceback|odoo\.exceptions|psycopg2|File "|\.py"|ValueError|KeyError/i.test(msg)) return generic
  if ((msg.match(/\n/g)?.length ?? 0) > 3) return generic
  return msg
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  // Throttle order confirmation per customer (docs/security-rules.md: 3/min).
  const allowed = await checkRateLimit(`confirm:${parsed.commercial_partner_id}`, 3, 60)
  if (!allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many attempts. Please wait a moment and try again.' }, { status: 429 })
  }

  const { delivery_address_id, note, po_ref, delivery_date, schedule, remove_unavailable } = await req.json()

  if (!Number.isInteger(delivery_address_id) || delivery_address_id <= 0) {
    return NextResponse.json({ error: 'INVALID_DELIVERY_ADDRESS', message: 'Delivery address is required.' }, { status: 400 })
  }

  // Optional recurrence: validate up-front so a bad schedule is rejected before we
  // place the (non-reversible) order.
  let scheduleSpec: ReturnType<typeof normalizeScheduleInput> | null = null
  if (schedule !== undefined && schedule !== null) {
    scheduleSpec = normalizeScheduleInput(schedule)
    if (!scheduleSpec.ok) {
      return NextResponse.json({ error: 'INVALID_SCHEDULE', message: scheduleSpec.error }, { status: 400 })
    }
  }

  // The note cap is admin-configurable (checkoutNoteMaxLength); read the same
  // value the client textarea uses so a UI-accepted note is never rejected here.
  // Strip HTML before it reaches sale.order.note (an Odoo Html field).
  const noteMaxLength = USE_MOCK
    ? DEFAULT_SITE_SETTINGS.checkoutNoteMaxLength
    : (await (await import('@/lib/odoo/odoo-helpers')).getSiteSettings()).checkoutNoteMaxLength
  let cleanNote = ''
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string' || note.length > noteMaxLength) {
      return NextResponse.json({ error: 'INVALID_NOTE', message: `Note must be a string under ${noteMaxLength} characters.` }, { status: 400 })
    }
    cleanNote = stripHtml(note)
  }

  // Optional PO / customer reference (maps to sale.order.client_order_ref).
  if (po_ref !== undefined && (typeof po_ref !== 'string' || po_ref.length > 100)) {
    return NextResponse.json({ error: 'INVALID_PO_REF', message: 'Reference must be under 100 characters.' }, { status: 400 })
  }

  // Optional requested delivery date YYYY-MM-DD (maps to sale.order.commitment_date). Must be
  // a valid date and not in the past - compared against the Bangkok calendar day, and stored
  // at 09:00 Bangkok (= 02:00 UTC) so staff see the intended morning slot.
  let commitmentDate: string | null = null
  if (delivery_date !== undefined && delivery_date !== null && delivery_date !== '') {
    if (typeof delivery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(delivery_date) || Number.isNaN(Date.parse(delivery_date))) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_DATE', message: 'Delivery date is invalid.' }, { status: 400 })
    }
    if (delivery_date < todayBkk()) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_DATE', message: 'Delivery date cannot be in the past.' }, { status: 400 })
    }
    commitmentDate = `${delivery_date} 02:00:00` // 09:00 Asia/Bangkok expressed in UTC
  }

  if (USE_MOCK) {
    return NextResponse.json({
      order_id: 789,
      order_name: 'S00123',
      state: 'sale',
      amount_total: 3150.00,
      currency: 'THB',
      already_confirmed: false,
    })
  }

  try {
    const sessionId = await getOdooSession()
    const { findCart, findUnorderableTemplateIdsLive, getAvailableUnitsForOrdering } = await import('@/lib/odoo/odoo-helpers')
    const { callKw, searchRead, OdooError } = await import('@/lib/odoo/client')

    const cartId = await findCart(sessionId, parsed.partner_id)
    if (!cartId) {
      return NextResponse.json({ error: 'CART_EMPTY', message: 'No active cart found.' }, { status: 400 })
    }

    // Read current cart state for idempotency check
    const orders = await callKw(sessionId, 'sale.order', 'read', [[cartId]], {
      fields: ['id', 'name', 'state', 'amount_total', 'currency_id'],
    }) as { id: number; name: string; state: string; amount_total: number; currency_id: [number, string] }[]

    const order = orders[0]
    if (!order) return NextResponse.json({ error: 'CART_EMPTY', message: 'Cart not found.' }, { status: 400 })

    // Idempotency: if already confirmed, return existing order data
    if (order.state === 'sale' || order.state === 'done') {
      return NextResponse.json({
        order_id: order.id,
        order_name: order.name,
        state: order.state,
        amount_total: order.amount_total,
        currency: order.currency_id[1] ?? 'THB',
        already_confirmed: true,
      })
    }

    // Live stock re-check at the moment of ordering (catches a stock drop within the
    // review cache window). Out-of-stock lines are SEPARATED from the order, and lines
    // ordering more than what's currently available are CLAMPED down to it - neither ever
    // reaches Odoo as written. Without an explicit acknowledgement we return the offending
    // template ids so the checkout page can show the split and ask the buyer to confirm;
    // with remove_unavailable we unlink/clamp here and place the order with the rest.
    const lineRows = await searchRead(sessionId, 'sale.order.line',
      [['order_id', '=', cartId]], ['id', 'product_template_id', 'product_packaging_id', 'product_uom_qty'],
    ) as { id: number; product_template_id: [number, string] | false; product_packaging_id: [number, string] | false; product_uom_qty: number }[]
    const templateIdOf = (r: typeof lineRows[number]) => (Array.isArray(r.product_template_id) ? r.product_template_id[0] : 0)
    const lineTemplateIds = lineRows.map(templateIdOf).filter(Boolean)
    const unorderable = await findUnorderableTemplateIdsLive(sessionId, lineTemplateIds)

    // Quantity cap: only for lines whose template IS orderable (an unorderable template's
    // lines are removed entirely below, regardless of quantity). Sum committed units PER
    // TEMPLATE (a customer can split one product across multiple packaging lines) against
    // what's actually available right now.
    const orderableLines = lineRows.filter(r => !unorderable.has(templateIdOf(r)))
    const orderableTemplateIds = Array.from(new Set(orderableLines.map(templateIdOf).filter(Boolean)))
    const availableMap = await getAvailableUnitsForOrdering(sessionId, orderableTemplateIds)
    const byTemplate = new Map<number, typeof orderableLines>()
    for (const r of orderableLines) {
      const tid = templateIdOf(r)
      if (!tid) continue
      const list = byTemplate.get(tid)
      if (list) list.push(r)
      else byTemplate.set(tid, [r])
    }
    const overQtyTemplateIds = new Set<number>()
    Array.from(byTemplate.entries()).forEach(([tid, lines]) => {
      const available = availableMap.get(tid) ?? null
      if (available === null) return
      const committed = lines.reduce((s, l) => s + l.product_uom_qty, 0)
      if (committed > available) overQtyTemplateIds.add(tid)
    })

    let removedCount = 0
    let adjustedCount = 0
    if (unorderable.size > 0 || overQtyTemplateIds.size > 0) {
      if (!remove_unavailable) {
        return NextResponse.json(
          {
            error: 'CART_NEEDS_ADJUSTMENT',
            message: unorderable.size > 0
              ? 'Some items are no longer in stock, or their quantity exceeds what is available.'
              : 'Some quantities exceed what is currently available.',
            template_ids: Array.from(unorderable),
            qty_exceeded_template_ids: Array.from(overQtyTemplateIds),
          },
          { status: 409 },
        )
      }
      // Acknowledged: drop the out-of-stock lines from the cart, then continue.
      // Compare against product lines only (ignore any section/note display_type rows)
      // so removing every product still trips the all-out-of-stock guard.
      const productLineIds = lineRows.filter(r => templateIdOf(r)).map(r => r.id)
      const removeLineIds = lineRows.filter(r => unorderable.has(templateIdOf(r))).map(r => r.id)
      if (removeLineIds.length > 0) {
        await callKw(sessionId, 'sale.order.line', 'unlink', [removeLineIds], {})
        removedCount = removeLineIds.length
      }
      if (removeLineIds.length >= productLineIds.length) {
        return NextResponse.json(
          { error: 'ALL_ITEMS_OUT_OF_STOCK', message: 'Every item in your cart is out of stock.' },
          { status: 409 },
        )
      }

      if (overQtyTemplateIds.size > 0) {
        // Clamp each over-quantity line to a whole number of packs that fits within what's
        // available, allocated across the template's lines in order. Needs units-per-pack
        // per line (1 for the "Unit" fallback packaging).
        const linesToClamp = orderableLines.filter(r => overQtyTemplateIds.has(templateIdOf(r)))
        const packagingIds = Array.from(new Set(
          linesToClamp.map(r => (r.product_packaging_id ? r.product_packaging_id[0] : null)).filter((id): id is number => id !== null),
        ))
        const packagingRows = packagingIds.length > 0
          ? await callKw(sessionId, 'product.packaging', 'read', [packagingIds], { fields: ['id', 'qty'] }) as { id: number; qty: number }[]
          : []
        const packQtyMap = new Map(packagingRows.map(p => [p.id, p.qty]))
        const unitsPerPackOf = (r: typeof linesToClamp[number]) => (r.product_packaging_id ? (packQtyMap.get(r.product_packaging_id[0]) ?? 1) : 1)

        for (const tid of Array.from(overQtyTemplateIds)) {
          const lines = byTemplate.get(tid) ?? []
          let remaining = availableMap.get(tid) ?? 0
          for (const line of lines) {
            const perPack = unitsPerPackOf(line)
            const packs = Math.floor(remaining / perPack)
            const newUnits = packs * perPack
            remaining -= newUnits
            if (newUnits === line.product_uom_qty) continue
            adjustedCount++
            if (newUnits <= 0) {
              await callKw(sessionId, 'sale.order.line', 'unlink', [[line.id]], {})
            } else {
              const writeVals: Record<string, unknown> = { product_uom_qty: newUnits }
              if (line.product_packaging_id) writeVals.product_packaging_qty = packs
              await callKw(sessionId, 'sale.order.line', 'write', [[line.id], writeVals], {})
            }
          }
        }
        // Clamping can zero out a line entirely (available dropped to 0 since review); guard
        // against confirming an order left with no product lines at all.
        const remainingProductLines = await callKw(sessionId, 'sale.order.line', 'search_count',
          [[['order_id', '=', cartId], ['product_template_id', '!=', false]]], {}) as number
        if (remainingProductLines === 0) {
          return NextResponse.json(
            { error: 'ALL_ITEMS_OUT_OF_STOCK', message: 'Every item in your cart is out of stock.' },
            { status: 409 },
          )
        }
      }
    }

    // Validate delivery address belongs to this commercial partner
    const { fetchDeliveryAddresses } = await import('@/lib/odoo/odoo-helpers')
    const addresses = await fetchDeliveryAddresses(sessionId, parsed.commercial_partner_id)
    const validAddress = addresses.find(a => a.id === delivery_address_id)
    if (!validAddress) {
      return NextResponse.json({ error: 'INVALID_DELIVERY_ADDRESS', message: 'Delivery address not valid.' }, { status: 400 })
    }

    // Write delivery address, note, optional PO ref + requested delivery date, and stamp
    // date_order to now (prevents stale draft dates).
    const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const writeVals: Record<string, unknown> = {
      partner_shipping_id: delivery_address_id,
      note: cleanNote,
      date_order: nowUtc,
    }
    if (typeof po_ref === 'string' && po_ref.trim()) writeVals.client_order_ref = po_ref.trim()
    if (commitmentDate) writeVals.commitment_date = commitmentDate
    await callKw(sessionId, 'sale.order', 'write', [[cartId], writeVals], {})

    // Confirm the order. A UserError here (credit limit, missing field, etc.) is a
    // business rejection, not an infra failure - surface it as 422 with the Odoo
    // message rather than a generic 503, and do NOT drop the admin token cache.
    try {
      await callKw(sessionId, 'sale.order', 'action_confirm', [[cartId]], {})
    } catch (confirmErr) {
      if (confirmErr instanceof OdooError && confirmErr.code === 'ODOO_ERROR') {
        return NextResponse.json(
          { error: 'ORDER_REJECTED', message: sanitizeOdooMessage(confirmErr.message) },
          { status: 422 },
        )
      }
      throw confirmErr
    }

    // The order is confirmed. If a recurrence was requested, snapshot the just-
    // confirmed order's lines and create the schedule. This is best-effort: if it
    // fails, the order is still placed and the client shows a warning (schedule_error)
    // rather than treating the whole checkout as failed.
    let scheduleId: string | undefined
    let scheduleError = false
    if (scheduleSpec?.ok) {
      try {
        scheduleId = await createSchedule({
          sessionId, orderId: cartId, spec: scheduleSpec.value,
          partnerId: parsed.partner_id, commercialPartnerId: parsed.commercial_partner_id,
          shippingAddressId: delivery_address_id, poRef: typeof po_ref === 'string' ? po_ref.trim() : '',
          note: cleanNote, lang: parsed.lang,
        })
      } catch (schedErr) {
        console.error('schedule creation failed (order still placed):', schedErr)
        scheduleError = true
      }
    }

    // The order is now confirmed in Odoo. If the read-back fails transiently, the
    // order still exists - return a success shape (using the pre-confirm read)
    // rather than a 503, so the client never re-submits and duplicates the order.
    try {
      const confirmed = await callKw(sessionId, 'sale.order', 'read', [[cartId]], {
        fields: ['id', 'name', 'state', 'amount_total', 'currency_id'],
      }) as { id: number; name: string; state: string; amount_total: number; currency_id: [number, string] }[]
      const co = confirmed[0]
      return NextResponse.json({
        order_id: co.id,
        order_name: co.name,
        state: co.state,
        amount_total: co.amount_total,
        currency: co.currency_id[1] ?? 'THB',
        already_confirmed: false,
        schedule_id: scheduleId,
        schedule_error: scheduleError || undefined,
        removed_count: removedCount || undefined,
        adjusted_count: adjustedCount || undefined,
      })
    } catch (readErr) {
      console.error('checkout confirm read-back failed (order already confirmed):', readErr)
      return NextResponse.json({
        order_id: order.id,
        order_name: order.name,
        state: 'sale',
        amount_total: order.amount_total,
        currency: order.currency_id[1] ?? 'THB',
        already_confirmed: false,
        schedule_id: scheduleId,
        schedule_error: scheduleError || undefined,
        removed_count: removedCount || undefined,
        adjusted_count: adjustedCount || undefined,
      })
    }
  } catch (err) {
    invalidateOdooSession()
    console.error('checkout confirm error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
