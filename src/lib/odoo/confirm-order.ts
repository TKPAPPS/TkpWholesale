import { callKw, OdooError } from '@/lib/odoo/client'

// Confirming a sale order, with a fallback around a broken third-party Odoo module.
//
// The direct route is `action_confirm` over JSON-RPC. That is preferred because Odoo returns a
// readable reason when it REJECTS an order (credit limit, blocked customer), and we show that
// verbatim to the customer.
//
// It crashes for any customer that resolves to a sister company. Confirming such an order makes
// Odoo raise an inter-company purchase order, and the custom module `bizzup_web_po_confirm`
// overrides purchase.order.create() with:
//
//     sale_order_id = request.session.get('sale_last_order_id')
//
// `request` is a Werkzeug proxy that only exists during a browser request. Over JSON-RPC nothing
// is bound, so it raises RuntimeError("object is not bound") and the customer cannot check out
// at all. Seven branch logins resolve to a sister company, so this is not an edge case.
//
// The workaround: Odoo's webhook endpoint IS a real HTTP route, so `request` is bound and
// `request.session.get(...)` returns None instead of raising. An automation rule on sale.order
// (trigger: on webhook) confirms the order named in the payload. Same confirmation, same
// inter-company PO, no change to the vendor's module.
//
// Direct first, webhook only on that specific crash, so business rejections keep their message
// and only the broken path pays the extra round trip. Retrying is safe: the failing call raises
// before committing, so Odoo has rolled it back.
//
// The vendor should still fix the module. It breaks EVERY purchase order created outside a
// browser request, which includes Odoo's own scheduled actions and imports, not just this portal.

const UNBOUND = 'object is not bound'

export class OrderRejected extends Error {
  constructor(message: string) { super(message) }
}

export async function confirmSaleOrder(sessionId: string, orderId: number): Promise<void> {
  try {
    await callKw(sessionId, 'sale.order', 'action_confirm', [[orderId]], {}, { scopeToCompany: false })
    return
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes(UNBOUND)) throw err
    console.warn('confirm hit the unbound-request defect, retrying via webhook:', { orderId })
  }

  const hook = process.env.ODOO_CONFIRM_WEBHOOK_URL
  if (!hook) {
    throw new OdooError('Order confirmation is unavailable. Please contact your sales representative.', 'ODOO_ERROR')
  }

  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: orderId }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) {
    throw new OdooError(`Confirmation webhook returned HTTP ${res.status}`, 'ODOO_ERROR')
  }

  // The webhook answers {"status":"ok"} whether or not the automation actually confirmed, so its
  // response proves nothing. Read the order back: the state is the only trustworthy signal, and
  // without this check a failed confirmation would be reported to the customer as success.
  const rows = await callKw(sessionId, 'sale.order', 'read', [[orderId]], { fields: ['state'] },
    { scopeToCompany: false }) as { state: string }[]
  const state = rows[0]?.state
  if (state !== 'sale' && state !== 'done') {
    throw new OdooError('Your order could not be confirmed. Please contact your sales representative.', 'ODOO_ERROR')
  }
}
