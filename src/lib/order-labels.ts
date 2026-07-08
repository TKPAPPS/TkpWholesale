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
