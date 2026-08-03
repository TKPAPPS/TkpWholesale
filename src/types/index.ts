export interface User {
  uid: number
  partner_id: number
  commercial_partner_id: number
  name: string
  email: string
  lang: 'en' | 'he'
  pricelist_id: number
  pricelist_name: string
}

export interface Category {
  id: number
  name: string
  name_he: string
  parent_id: number | null
  children: Category[]
}

export interface PackagingOption {
  id: number
  name: string
  qty: number
  price_per_pack_excl_tax: number
  price_per_pack_incl_tax: number
  price_per_unit_excl_tax: number
  price_per_unit_incl_tax: number
  is_default: boolean
}

export interface Product {
  id: number
  template_id: number
  variant_id: number
  name: string
  name_he: string
  sku: string
  description: string
  description_he: string
  image_url: string
  categories: { id: number; name: string; name_he: string }[]
  uom_name: string
  packaging_options: PackagingOption[]
  currency: string
  tax_display: 'incl_tax' | 'excl_tax'
  tax_names: string[]
  sellable: boolean
  in_stock: boolean
  qty_available: number
}

export interface CartLine {
  line_id: number
  product_id: number
  template_id: number
  product_name: string
  product_name_he: string
  product_image_url: string
  sku: string
  packaging_id: number
  packaging_name: string
  packaging_qty: number
  unit_qty: number
  price_unit: number
  price_per_pack: number
  price_subtotal: number
  price_total: number
  warnings: string[]
}

// Lightweight result type for the global search overlay.
// Skips pricelist adjustment, categories, and full tax calculation.
export interface SearchHit {
  id: number
  template_id: number
  name: string
  name_he: string
  sku: string
  image_url: string
  currency: string
  packaging_options: Pick<PackagingOption, 'id' | 'name' | 'qty' | 'price_per_pack_incl_tax' | 'price_per_unit_incl_tax' | 'is_default'>[]
  sellable: boolean
  in_stock: boolean
  qty_available: number
}

export interface Cart {
  cart_id: number
  state: 'draft' | 'sent' | 'sale' | 'done' | 'cancel'
  partner_shipping_id: number | null
  partner_shipping_name: string
  note: string
  lines: CartLine[]
  amount_untaxed: number
  amount_tax: number
  amount_total: number
  currency: string
  warnings: string[]
}

export interface DeliveryAddress {
  id: number
  name: string
  street: string
  street2?: string
  city: string
  zip: string
  country: string
}

export interface Order {
  id: number
  name: string
  date_order: string
  amount_total: number
  currency: string
  state: string
  delivery_status: string | null
  state_label: string
  line_count: number
}

export interface OrderLine {
  line_id: number
  product_id: number
  template_id: number
  packaging_id: number | null
  product_name: string
  product_name_he: string
  sku: string
  packaging_name: string
  packaging_qty: number
  unit_qty: number
  price_unit: number
  price_subtotal: number
  price_total: number
}

export interface OrderDetail extends Order {
  partner_shipping: DeliveryAddress
  note: string
  client_order_ref: string
  commitment_date: string
  lines: OrderLine[]
  amount_untaxed: number
  amount_tax: number
}

export interface Invoice {
  id: number
  name: string
  invoice_date: string
  invoice_date_due: string | null
  amount_total: number
  amount_residual: number
  payment_state: 'not_paid' | 'partial' | 'in_payment' | 'paid'
  currency: string
  state_label: string
  line_count: number
}

export interface InvoiceLine {
  line_id: number
  name: string
  quantity: number
  price_unit: number
  price_subtotal: number
  price_total: number
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[]
  note: string
  amount_untaxed: number
  amount_tax: number
}

export interface ApiError {
  error: string
  message: string
  details?: Record<string, unknown>
}
