import { callKw, searchRead } from './client'
import { langContext } from './session'
import type { Product, PackagingOption, Cart, CartLine } from '@/types'

const WEBSITE_ID = Number(process.env.ODOO_WEBSITE_ID ?? 3)

// ─── Types for raw Odoo records ───────────────────────────────────────────────

interface OdooProduct {
  id: number
  name: string
  default_code: string | false
  description_sale: string | false
  list_price: number
  uom_id: [number, string]
  public_categ_ids: number[]
  taxes_id: number[]
  qty_available: number
  type: string
  product_variant_ids: number[]
  packaging_ids: number[]
}

interface OdooWebsiteSetting {
  product_tmpl_id: [number, string]
  is_published: boolean
  allow_out_of_stock_order: boolean
}

interface OdooPackaging {
  id: number
  name: string
  qty: number
  product_id: [number, string]
  sales: boolean
}

interface OdooTax {
  id: number
  name: string
  amount: number
  price_include: boolean
}

interface OdooCategory {
  id: number
  name: string
  parent_id: [number, string] | false
  child_id: number[]
}

interface OdooCartLine {
  id: number
  product_id: [number, string]
  product_template_id: [number, string]
  product_packaging_id: [number, string] | false
  product_packaging_qty: number
  product_uom_qty: number
  price_unit: number
  price_subtotal: number
  price_total: number
  name: string
}

interface OdooOrder {
  id: number
  name: string
  state: string
  partner_id: [number, string]
  commercial_partner_id: [number, string]
  partner_shipping_id: [number, string] | false
  note: string | false
  amount_untaxed: number
  amount_tax: number
  amount_total: number
  currency_id: [number, string]
  order_line: number[]
  website_id: [number, string] | false
  date_order: string
}

// ─── Product helpers ──────────────────────────────────────────────────────────

const PRODUCT_FIELDS = [
  'id', 'name', 'default_code', 'description_sale', 'list_price',
  'uom_id', 'public_categ_ids', 'taxes_id', 'qty_available',
  'type', 'product_variant_ids', 'packaging_ids',
]

// In-memory cache for the hide_out_of_stock portal setting (TTL: 60s)
let _hideOosCache: { value: boolean; expires: number } | null = null

export function bustHideOosCache() { _hideOosCache = null }

async function getHideOutOfStock(sessionId: string): Promise<boolean> {
  const now = Date.now()
  if (_hideOosCache && now < _hideOosCache.expires) return _hideOosCache.value

  try {
    const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
      [[['key', '=', 'b2b_portal.hide_out_of_stock']]],
      { fields: ['value'], limit: 1 },
    ) as unknown as { value: string }[]
    const value = rows[0]?.value === 'false' ? false : true  // default true if not set
    _hideOosCache = { value, expires: now + 60_000 }
    return value
  } catch {
    return true  // safe default: hide OOS products
  }
}

export async function fetchRecentlyPublishedIds(sessionId: string, publishedAfter: string): Promise<number[]> {
  const rows = await callKw(sessionId, 'product.website.settings', 'search_read',
    [[['website_id', '=', WEBSITE_ID], ['is_published', '=', true], ['create_date', '>=', publishedAfter]]],
    { fields: ['product_tmpl_id'] },
  ) as unknown as { product_tmpl_id: [number, string] }[]
  return rows.map(r => r.product_tmpl_id[0])
}

// Cache for website published settings — costs 1.1s to fetch 2231 rows, so cache 5 minutes
let _websiteSettingsCache: { map: Map<number, boolean>; expires: number } | null = null

export function bustWebsiteSettingsCache() { _websiteSettingsCache = null }

// Fetch the set of template IDs published on our website, plus their per-website OOS flag.
// This is the source of truth — product.template.website_published is global, not per-website.
async function fetchWebsitePublishedSettings(sessionId: string): Promise<Map<number, boolean>> {
  const now = Date.now()
  if (_websiteSettingsCache && now < _websiteSettingsCache.expires) return _websiteSettingsCache.map

  const settings = await callKw(
    sessionId,
    'product.website.settings',
    'search_read',
    [[['website_id', '=', WEBSITE_ID], ['is_published', '=', true]]],
    { fields: ['product_tmpl_id', 'allow_out_of_stock_order'] },
  ) as unknown as OdooWebsiteSetting[]

  const map = new Map(settings.map(s => [s.product_tmpl_id[0], s.allow_out_of_stock_order]))
  _websiteSettingsCache = { map, expires: now + 5 * 60_000 }  // 5-minute TTL
  return map
}

export async function fetchOdooProducts(
  sessionId: string,
  domain: unknown[],
  opts: { limit?: number; offset?: number; order?: string } = {},
): Promise<{ products: Product[]; total: number }> {
  // Step 1: fetch website settings and the portal hide-OOS toggle in parallel
  const [websiteSettingsMap, hideOos] = await Promise.all([
    fetchWebsitePublishedSettings(sessionId),
    getHideOutOfStock(sessionId),
  ])
  if (websiteSettingsMap.size === 0) return { products: [], total: 0 }

  const publishedIds = Array.from(websiteSettingsMap.keys())
  let baseDomain: unknown[]

  if (hideOos) {
    // Split into two buckets:
    //   oosIds  — OOS allowed → always visible regardless of stock
    //   noOosIds — OOS not allowed → only visible when qty_available > 0
    const oosIds: number[] = []
    const noOosIds: number[] = []
    for (const [id, allowOos] of websiteSettingsMap) {
      if (allowOos) oosIds.push(id)
      else noOosIds.push(id)
    }

    // Domain: (id in oosIds) OR (id in noOosIds AND qty_available > 0)
    // Odoo prefix notation: '|' consumes next 2 terms; '&' consumes next 2 terms.
    baseDomain = [
      '|',
      ['id', 'in', oosIds],
      '&',
      ['id', 'in', noOosIds],
      ['qty_available', '>', 0],
      ['type', 'in', ['consu', 'storable']],
      ...domain,
    ]
  } else {
    // hide-OOS toggle off: show all published products regardless of stock
    baseDomain = [
      ['id', 'in', publishedIds],
      ['type', 'in', ['consu', 'storable']],
      ...domain,
    ]
  }

  // Run count + EN + HE fetches all in parallel — count doesn't affect which products we fetch
  const [count, enRaw, heRaw] = await Promise.all([
    callKw(sessionId, 'product.template', 'search_count', [baseDomain], {}) as Promise<number>,
    searchRead(sessionId, 'product.template', baseDomain, PRODUCT_FIELDS, {
      ...opts, context: { lang: 'en_US' }
    }) as unknown as Promise<OdooProduct[]>,
    searchRead(sessionId, 'product.template', baseDomain, ['id', 'name', 'description_sale'], {
      ...opts, context: { lang: 'he_IL' }
    }) as unknown as Promise<{ id: number; name: string; description_sale: string | false }[]>,
  ])

  if (enRaw.length === 0) return { products: [], total: count }

  const heMap = new Map(heRaw.map(p => [p.id, p]))

  // Collect all packaging IDs and tax IDs
  const allPackagingIds = Array.from(new Set(enRaw.flatMap(p => p.packaging_ids)))
  const allTaxIds = Array.from(new Set(enRaw.flatMap(p => p.taxes_id)))
  const allCatIds = Array.from(new Set(enRaw.flatMap(p => p.public_categ_ids)))

  // Batch fetch packaging, taxes, and categories in parallel
  const [packagings, taxes, enCats, heCats] = await Promise.all([
    allPackagingIds.length > 0
      ? callKw(sessionId, 'product.packaging', 'read', [allPackagingIds], {
          fields: ['id', 'name', 'qty', 'product_id', 'sales'],
        }) as unknown as Promise<OdooPackaging[]>
      : Promise.resolve([] as OdooPackaging[]),
    allTaxIds.length > 0
      ? callKw(sessionId, 'account.tax', 'read', [allTaxIds], {
          fields: ['id', 'name', 'amount', 'price_include'],
        }) as unknown as Promise<OdooTax[]>
      : Promise.resolve([] as OdooTax[]),
    allCatIds.length > 0
      ? callKw(sessionId, 'product.public.category', 'read', [allCatIds], {
          fields: ['id', 'name'], context: { lang: 'en_US' }
        }) as unknown as Promise<{ id: number; name: string }[]>
      : Promise.resolve([] as { id: number; name: string }[]),
    allCatIds.length > 0
      ? callKw(sessionId, 'product.public.category', 'read', [allCatIds], {
          fields: ['id', 'name'], context: { lang: 'he_IL' }
        }) as unknown as Promise<{ id: number; name: string }[]>
      : Promise.resolve([] as { id: number; name: string }[]),
  ])

  const packMap = new Map(packagings.map(p => [p.id, p]))
  const taxMap = new Map(taxes.map(t => [t.id, t]))
  const enCatMap = new Map(enCats.map(c => [c.id, c]))
  const heCatMap = new Map(heCats.map(c => [c.id, c]))

  const products: Product[] = enRaw.map(raw => {
    const he = heMap.get(raw.id)

    // Deduplicate taxes by (amount, price_include) — Odoo can assign the same
    // fiscal-position tax multiple times via multi-company or fiscal mapping
    const seenTaxSigs = new Set<string>()
    const uniqueTaxes = raw.taxes_id
      .map(tid => taxMap.get(tid))
      .filter((t): t is OdooTax => !!t && t.amount > 0)
      .filter(t => {
        const sig = `${t.amount}:${t.price_include}`
        if (seenTaxSigs.has(sig)) return false
        seenTaxSigs.add(sig)
        return true
      })

    // Separate included (already in list_price) vs excluded taxes
    const inclRate = uniqueTaxes.filter(t => t.price_include).reduce((s, t) => s + t.amount, 0)
    const exclRate = uniqueTaxes.filter(t => !t.price_include).reduce((s, t) => s + t.amount, 0)
    const taxNames = Array.from(new Set(uniqueTaxes.map(t => t.name)))

    // list_price with price_include taxes already baked in → back-compute excl
    const unitPriceExcl = inclRate > 0
      ? Math.round(raw.list_price / (1 + inclRate / 100) * 100) / 100
      : raw.list_price
    const unitPriceIncl = Math.round(unitPriceExcl * (1 + (inclRate + exclRate) / 100) * 100) / 100

    const templatePackagings = packagings.filter(p => raw.packaging_ids.includes(p.id) && p.sales)
    const packagingOptions: PackagingOption[] = templatePackagings.map((pkg, idx) => ({
      id: pkg.id,
      name: pkg.name,
      qty: pkg.qty,
      price_per_pack_excl_tax: Math.round(unitPriceExcl * pkg.qty * 100) / 100,
      price_per_pack_incl_tax: Math.round(unitPriceIncl * pkg.qty * 100) / 100,
      price_per_unit_excl_tax: unitPriceExcl,
      price_per_unit_incl_tax: Math.round(unitPriceIncl * 100) / 100,
      is_default: idx === 0,
    }))

    // If no portal packagings, create a "unit" fallback so product is orderable
    if (packagingOptions.length === 0) {
      packagingOptions.push({
        id: 0,
        name: raw.uom_id[1] ?? 'Unit',
        qty: 1,
        price_per_pack_excl_tax: unitPriceExcl,
        price_per_pack_incl_tax: Math.round(unitPriceIncl * 100) / 100,
        price_per_unit_excl_tax: unitPriceExcl,
        price_per_unit_incl_tax: Math.round(unitPriceIncl * 100) / 100,
        is_default: true,
      })
    }

    const inStock = raw.qty_available > 0
    // Use per-website OOS flag from product.website.settings, not the global template flag
    const allowOos = websiteSettingsMap.get(raw.id) ?? false
    const sellable = inStock || allowOos

    return {
      id: raw.id,
      template_id: raw.id,
      variant_id: raw.product_variant_ids[0] ?? raw.id,
      name: raw.name,
      name_he: he?.name ?? raw.name,
      sku: raw.default_code || '',
      description: typeof raw.description_sale === 'string' ? raw.description_sale : '',
      description_he: typeof he?.description_sale === 'string' ? he.description_sale : '',
      image_url: `/api/images/product/${raw.id}/512`,
      categories: raw.public_categ_ids.map(cid => ({
        id: cid,
        name: enCatMap.get(cid)?.name ?? '',
        name_he: heCatMap.get(cid)?.name ?? '',
      })),
      uom_name: raw.uom_id[1] ?? '',
      packaging_options: packagingOptions,
      currency: 'THB',
      tax_display: 'incl_tax',
      tax_names: taxNames,
      sellable,
      in_stock: inStock,
    }
  })

  return { products, total: count }
}

// ─── Category helpers ─────────────────────────────────────────────────────────

export async function fetchOdooCategories(sessionId: string) {
  // Website-scoped domain: global categories (no website) + TKP Wholesale-specific ones
  const catDomain = [['website_id', 'in', [false, WEBSITE_ID]]]

  const [enCats, heCats, hiddenRows] = await Promise.all([
    callKw(sessionId, 'product.public.category', 'search_read',
      [catDomain],
      { fields: ['id', 'name', 'parent_id', 'child_id'], context: { lang: 'en_US' } },
    ) as unknown as Promise<OdooCategory[]>,
    callKw(sessionId, 'product.public.category', 'search_read',
      [catDomain],
      { fields: ['id', 'name'], context: { lang: 'he_IL' } },
    ) as unknown as Promise<{ id: number; name: string }[]>,
    callKw(sessionId, 'ir.config_parameter', 'search_read',
      [[['key', '=', 'b2b_portal.hidden_category_ids']]],
      { fields: ['value'], limit: 1 },
    ) as unknown as Promise<{ value: string }[]>,
  ])

  const hiddenSet = new Set<number>(
    hiddenRows[0]?.value ? hiddenRows[0].value.split(',').map(Number).filter(Boolean) : []
  )

  const heMap = new Map(heCats.map(c => [c.id, c]))
  const visible = enCats.filter(c => !hiddenSet.has(c.id))

  type CategoryNode = { id: number; name: string; name_he: string; parent_id: number | null; children: CategoryNode[] }
  const buildTree = (parentId: number | null): CategoryNode[] => {
    return visible
      .filter(c => (parentId === null ? !c.parent_id : c.parent_id && c.parent_id[0] === parentId))
      .map(c => ({
        id: c.id,
        name: c.name,
        name_he: heMap.get(c.id)?.name ?? c.name,
        parent_id: c.parent_id ? c.parent_id[0] : null,
        children: buildTree(c.id),
      }))
  }

  return buildTree(null)
}

// ─── Cart helpers ─────────────────────────────────────────────────────────────

async function readCartLines(sessionId: string, orderId: number): Promise<CartLine[]> {
  const lines = await searchRead(sessionId, 'sale.order.line', [['order_id', '=', orderId]], [
    'id', 'product_id', 'product_template_id', 'product_packaging_id',
    'product_packaging_qty', 'product_uom_qty', 'price_unit',
    'price_subtotal', 'price_total', 'name',
  ]) as unknown as OdooCartLine[]

  return lines.map(line => ({
    line_id: line.id,
    product_id: line.product_id[0],
    template_id: line.product_template_id[0],
    product_name: line.product_template_id[1] ?? line.name,
    product_name_he: line.product_template_id[1] ?? line.name,
    product_image_url: `/api/images/product/${line.product_template_id[0]}/128`,
    sku: '',
    packaging_id: line.product_packaging_id ? line.product_packaging_id[0] : 0,
    packaging_name: line.product_packaging_id ? line.product_packaging_id[1] : 'Unit',
    packaging_qty: line.product_packaging_qty,
    unit_qty: line.product_uom_qty,
    price_unit: line.price_unit,
    price_per_pack: line.product_packaging_qty > 0
      ? Math.round((line.price_subtotal / line.product_packaging_qty) * 100) / 100
      : line.price_subtotal,
    price_subtotal: line.price_subtotal,
    price_total: line.price_total,
    warnings: [],
  }))
}

export async function readCart(sessionId: string, orderId: number): Promise<Cart> {
  const orders = await callKw(sessionId, 'sale.order', 'read', [[orderId]], {
    fields: ['id', 'name', 'state', 'partner_shipping_id', 'note', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id'],
  }) as unknown as OdooOrder[]

  const order = orders[0]
  const lines = await readCartLines(sessionId, orderId)

  return {
    cart_id: order.id,
    state: order.state as Cart['state'],
    partner_shipping_id: order.partner_shipping_id ? order.partner_shipping_id[0] : null,
    partner_shipping_name: order.partner_shipping_id ? order.partner_shipping_id[1] : '',
    note: order.note || '',
    lines,
    amount_untaxed: order.amount_untaxed,
    amount_tax: order.amount_tax,
    amount_total: order.amount_total,
    currency: order.currency_id[1] ?? 'THB',
    warnings: [],
  }
}

export async function findCart(sessionId: string, partnerId: number): Promise<number | null> {
  const carts = await searchRead(sessionId, 'sale.order',
    [['partner_id', '=', partnerId], ['state', '=', 'draft']],
    ['id'],
    { limit: 1, order: 'id desc' },
  ) as unknown as { id: number }[]
  return carts[0]?.id ?? null
}

export async function getOrCreateCart(
  sessionId: string,
  partnerId: number,
  pricelistId: number | null,
): Promise<number> {
  const existing = await findCart(sessionId, partnerId)
  if (existing) return existing

  const createVals: Record<string, unknown> = {
    partner_id: partnerId,
    website_id: WEBSITE_ID,
  }
  if (pricelistId) createVals.pricelist_id = pricelistId

  const orderId = await callKw(sessionId, 'sale.order', 'create', [createVals], {}) as number
  return orderId
}

export function emptyCart(): Cart {
  return {
    cart_id: 0,
    state: 'draft',
    partner_shipping_id: null,
    partner_shipping_name: '',
    note: '',
    lines: [],
    amount_untaxed: 0,
    amount_tax: 0,
    amount_total: 0,
    currency: 'THB',
    warnings: [],
  }
}

// Validate that an order belongs to this partner (security check)
export async function assertOrderOwnership(
  sessionId: string,
  orderId: number,
  commercialPartnerId: number,
): Promise<OdooOrder> {
  const orders = await callKw(sessionId, 'sale.order', 'read', [[orderId]], {
    fields: ['id', 'partner_id', 'commercial_partner_id', 'state', 'name',
      'partner_shipping_id', 'note', 'amount_untaxed', 'amount_tax', 'amount_total',
      'currency_id', 'date_order', 'order_line'],
  }) as unknown as OdooOrder[]

  const order = orders[0]
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' })

  // Check ownership: order's partner must be this commercial partner or a child of it
  const orderPartnerId = order.partner_id[0]
  if (orderPartnerId !== commercialPartnerId && order.commercial_partner_id[0] !== commercialPartnerId) {
    throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' })
  }

  return order
}

// Fetch delivery addresses for a commercial partner
export async function fetchDeliveryAddresses(sessionId: string, commercialPartnerId: number) {
  const addresses = await searchRead(sessionId, 'res.partner',
    [
      '|',
      ['id', '=', commercialPartnerId],
      ['parent_id', '=', commercialPartnerId],
      ['type', 'in', ['delivery', 'contact', 'other']],
      ['active', '=', true],
    ],
    ['id', 'name', 'street', 'street2', 'city', 'zip', 'country_id'],
  ) as unknown as { id: number; name: string; street: string | false; street2: string | false; city: string | false; zip: string | false; country_id: [number, string] | false }[]

  return addresses.map(a => ({
    id: a.id,
    name: a.name,
    street: a.street || '',
    street2: a.street2 || undefined,
    city: a.city || '',
    zip: a.zip || '',
    country: a.country_id ? a.country_id[1] : '',
  }))
}

// Validate that a line's packaging belongs to the given product template
export async function validatePackaging(
  sessionId: string,
  templateId: number,
  packagingId: number,
): Promise<{ qty: number; productVariantId: number } | null> {
  if (packagingId === 0) {
    // unit packaging — get first variant
    const variants = await searchRead(sessionId, 'product.product',
      [['product_tmpl_id', '=', templateId]],
      ['id'],
      { limit: 1 },
    ) as unknown as { id: number }[]
    return variants[0] ? { qty: 1, productVariantId: variants[0].id } : null
  }

  const pkgs = await callKw(sessionId, 'product.packaging', 'read', [[packagingId]], {
    fields: ['id', 'qty', 'product_id', 'sales'],
  }) as unknown as { id: number; qty: number; product_id: [number, string]; sales: boolean }[]

  const pkg = pkgs[0]
  if (!pkg || !pkg.sales) return null

  // Verify this packaging belongs to a variant of the requested template
  const variant = await callKw(sessionId, 'product.product', 'read', [[pkg.product_id[0]]], {
    fields: ['id', 'product_tmpl_id'],
  }) as unknown as { id: number; product_tmpl_id: [number, string] }[]

  if (variant[0]?.product_tmpl_id[0] !== templateId) return null

  return { qty: pkg.qty, productVariantId: pkg.product_id[0] }
}
