// Canonical sale-order status labels, shared by the orders list and detail routes
// so the same order never shows one label in the list and a different one on its
// own page. Import-safe on server and client.

export const ORDER_STATE_LABELS: Record<string, string> = {
  draft: 'Quotation',
  sent: 'Sent',
  sale: 'Confirmed',
  done: 'Completed',
  cancel: 'Cancelled',
}

// Odoo delivery_status, when present, is the more customer-meaningful signal.
export const ORDER_DELIVERY_LABELS: Record<string, string> = {
  pending: 'Confirmed',
  partial: 'Partially Shipped',
  full: 'Delivered',
}

export function orderStateLabel(state: string, deliveryStatus?: string | null): string {
  if (deliveryStatus && ORDER_DELIVERY_LABELS[deliveryStatus]) {
    return ORDER_DELIVERY_LABELS[deliveryStatus]
  }
  return ORDER_STATE_LABELS[state] ?? state
}

// One line as far as delivery reporting is concerned.
export interface DeliveryLine {
  qty_ordered: number
  qty_delivered: number
  deliverable: boolean   // qty_delivered_method === 'stock_move'
  weighed: boolean       // priced by weight, so delivered legitimately differs
}

export type DeliveryState = 'full' | 'partial' | 'none' | 'unknown'

// Derive delivery state from the LINES rather than Odoo's delivery_status.
//
// delivery_status cannot be trusted for a customer-facing badge: it reports "full" once
// nothing is outstanding, and a CANCELLED line is not outstanding. Order S17189 read "full"
// with two of fourteen lines never shipped, so the portal told the customer their order had
// arrived complete when it had not.
//
// Only stock-tracked lines count. Charge lines (Delivery Service and similar) sit at
// delivered 0 forever and would drag every rep-entered order down to "partial".
// Weight-priced lines count as delivered on any positive quantity, because the picked weight
// is rarely the ordered number and comparing them would report a permanent shortfall.
export function deliveryStateFromLines(lines: DeliveryLine[]): DeliveryState {
  const physical = lines.filter((l) => l.deliverable)
  if (physical.length === 0) return 'unknown'
  const isDone = (l: DeliveryLine) =>
    l.weighed ? l.qty_delivered > 0 : l.qty_delivered >= l.qty_ordered
  const done = physical.filter(isDone).length
  const started = physical.filter((l) => l.qty_delivered > 0).length
  if (done === physical.length) return 'full'
  if (started > 0 || done > 0) return 'partial'
  return 'none'
}

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  full: 'Delivered',
  partial: 'Partly delivered',
  none: 'Not delivered',
  unknown: 'Confirmed',
}
