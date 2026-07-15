import { callKw, searchRead } from './client'
import { getOdooSession } from './admin-session'
import { langContext } from './session'
import type { Product, PackagingOption, Cart, CartLine } from '@/types'
import { unstable_cache, revalidateTag } from 'next/cache'
import { DEFAULT_SITE_SETTINGS, sanitizeSiteSettings, type SiteSettings } from '@/lib/site-settings'

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
  categ_id: [number, string] | false
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

interface OdooPricelistItem {
  id: number
  applied_on: '0_product_variant' | '1_product' | '2_product_category' | '3_global'
  product_tmpl_id: [number, string] | false
  product_id: [number, string] | false
  categ_id: [number, string] | false
  compute_price: 'fixed' | 'percentage' | 'formula'
  percent_price: number
  price_discount: number
  fixed_price: number
  price_surcharge: number
  min_quantity: number
}

function applyPricelistItem(item: OdooPricelistItem, listPrice: number): number {
  switch (item.compute_price) {
    case 'fixed': return item.fixed_price
    case 'percentage': return Math.round(listPrice * (1 - item.percent_price / 100) * 100) / 100
    case 'formula': return Math.round((listPrice * (1 - item.price_discount / 100) + item.price_surcharge) * 100) / 100
    default: return listPrice
  }
}

// Priority: lower number = higher specificity
const PRICELIST_PRIORITY: Record<string, number> = {
  '0_product_variant': 0,
  '1_product': 1,
  '2_product_category': 2,
  '3_global': 3,
}

// `categAncestors` maps product.id -> the set of its internal category id and all ancestor
// category ids, so a `2_product_category` rule matches when its category is the product's
// category or any ancestor (Odoo's child_of semantics). Omitted when the pricelist has no
// category rules.
function buildPlPriceMap(
  products: OdooProduct[],
  items: OdooPricelistItem[],
  categAncestors?: Map<number, Set<number>>,
): Map<number, number> {
  const map = new Map<number, number>()
  const applicable = items.filter(it => it.min_quantity <= 1)

  for (const product of products) {
    let bestPrice: number | null = null
    let bestPriority = Infinity
    let bestMinQty = -1

    for (const item of applicable) {
      const p = PRICELIST_PRIORITY[item.applied_on] ?? 99
      let matches = false
      if (item.applied_on === '0_product_variant') {
        matches = !!(item.product_id && product.product_variant_ids.includes(item.product_id[0]))
      } else if (item.applied_on === '1_product') {
        matches = !!(item.product_tmpl_id && item.product_tmpl_id[0] === product.id)
      } else if (item.applied_on === '2_product_category') {
        const anc = categAncestors?.get(product.id)
        matches = !!(item.categ_id && anc && anc.has(item.categ_id[0]))
      } else if (item.applied_on === '3_global') {
        matches = true
      }
      if (!matches) continue
      if (p < bestPriority || (p === bestPriority && item.min_quantity > bestMinQty)) {
        bestPrice = applyPricelistItem(item, product.list_price)
        bestPriority = p
        bestMinQty = item.min_quantity
      }
    }

    if (bestPrice !== null && bestPrice > 0) map.set(product.id, bestPrice)
  }
  return map
}

// Resolve a partner's CURRENT pricelist server-side, cached per partner. The session cookie
// captures pricelist_id at login (4h TTL), so a pricelist change in Odoo wouldn't show until
// re-login; reading it here (cached ~5 min) makes changes take effect within the cache window.
const _fetchPartnerPricelistId = unstable_cache(
  async (partnerId: number): Promise<number | null> => {
    const sessionId = await getOdooSession()
    const rows = await callKw(sessionId, 'res.partner', 'read', [[partnerId]],
      { fields: ['property_product_pricelist'] },
    ) as { property_product_pricelist: [number, string] | false }[]
    const pl = rows[0]?.property_product_pricelist
    return pl ? pl[0] : null
  },
  ['odoo-partner-pricelist'],
  { revalidate: 300, tags: ['odoo-partner-pricelist'] },
)

export async function getPartnerPricelistId(partnerId: number): Promise<number | null> {
  try {
    return await _fetchPartnerPricelistId(partnerId)
  } catch {
    return null
  }
}

// Look up the pricelist price for a single product template.
// Used when creating/updating cart lines so price_unit is correct for the customer's pricelist.
// Returns null if no rule applies or the lookup fails — caller should fall back to Odoo default.
export async function lookupPricelistPrice(
  sessionId: string,
  pricelistId: number | null,
  templateId: number,
): Promise<number | null> {
  if (!pricelistId) return null
  try {
    // Fetch the pricelist items and the template list_price in parallel — the
    // list_price is only needed for percentage/formula rules, but fetching it
    // upfront saves a serial Odoo round-trip (~250ms EU) on that path.
    const [items, tmpl] = await Promise.all([
      callKw(sessionId, 'product.pricelist.item', 'search_read',
        [[
          ['pricelist_id', '=', pricelistId],
          '|',
          ['applied_on', '=', '3_global'],
          ['product_tmpl_id', '=', templateId],
        ]],
        { fields: ['id', 'applied_on', 'compute_price', 'percent_price', 'price_discount',
                   'fixed_price', 'price_surcharge', 'min_quantity'] },
      ) as Promise<OdooPricelistItem[]>,
      callKw(sessionId, 'product.template', 'read', [[templateId]],
        { fields: ['list_price'] },
      ) as Promise<{ list_price: number }[]>,
    ])

    const applicable = items.filter(it => it.min_quantity <= 1)
    if (applicable.length === 0) return null

    const best = applicable.sort(
      (a, b) => (PRICELIST_PRIORITY[a.applied_on] ?? 99) - (PRICELIST_PRIORITY[b.applied_on] ?? 99)
    )[0]

    if (best.compute_price === 'fixed') return best.fixed_price

    // percentage / formula — uses list_price to compute the discount
    return applyPricelistItem(best, tmpl[0]?.list_price ?? 0)
  } catch (err) {
    console.warn('lookupPricelistPrice error:', err)
    return null
  }
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
  partner_shipping_id: [number, string] | false
  note: string | false
  client_order_ref: string | false
  commitment_date: string | false
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
  'uom_id', 'public_categ_ids', 'categ_id', 'taxes_id', 'qty_available',
  'type', 'product_variant_ids', 'packaging_ids',
]

// Fetch hide-OOS setting via Next.js data cache — shared across all Vercel instances.
// unstable_cache persists results in Vercel's infrastructure, surviving cold starts.
const _fetchHideOos = unstable_cache(
  async (): Promise<boolean> => {
    const sessionId = await getOdooSession()
    const value = await callKw(sessionId, 'ir.config_parameter', 'get_param',
      ['b2b_portal.hide_out_of_stock', 'true'], {},
    ) as string | false
    return value === false ? true : value !== 'false'
  },
  ['odoo-hide-oos'],
  { revalidate: 60, tags: ['odoo-hide-oos'] },
)

// The product LISTING is cached under 'odoo-products' and resolves hide-OOS,
// published settings, and hidden-products INSIDE that cached function. So changing
// any of those must also bust 'odoo-products', or the listing stays stale up to 5 min.
export function bustHideOosCache() { revalidateTag('odoo-hide-oos'); revalidateTag('odoo-products') }

export async function getHideOutOfStock(_sessionId: string): Promise<boolean> {
  try {
    return await _fetchHideOos()
  } catch {
    return true  // safe default: hide OOS products
  }
}

// Build the Odoo domain that decides which published products are visible,
// mirroring the website's stock rules. Shared by the product listing and the
// search route so both apply identical visibility:
//   hideOos on  → (allows OOS) OR (in stock), limited to stockable/consumable types
//   hideOos off → all published products
// `extra` is ANDed on (implicit AND across top-level terms) — e.g. a name/sku
// match for search, or the new-arrivals id filter for the listing.
export function buildVisibilityDomain(
  settingsMap: Map<number, boolean>,   // templateId -> allow_out_of_stock_order
  hideOos: boolean,
  inStockIds: Set<number> | null,      // in-stock template ids; null = stock unknown
  hiddenIds: Set<number>,              // admin-hidden template ids (always excluded)
  extra: unknown[] = [],
): unknown[] {
  if (hideOos) {
    // Resolve stock in JS against the cached in-stock set instead of via a
    // `qty_available > 0` SQL term (which forces Odoo to compute live stock for the
    // whole catalog, ~600ms). The result is a single `id in [...]` list — ~60ms.
    // Show a product if it allows OOS ordering, or it's in stock. If the in-stock set
    // is unavailable (null), don't filter on stock so a transient failure shows the
    // catalog rather than emptying it. Admin-hidden products are never shown.
    const visibleIds: number[] = []
    settingsMap.forEach((allowOos, id) => {
      if (hiddenIds.has(id)) return
      if (allowOos || inStockIds === null || inStockIds.has(id)) visibleIds.push(id)
    })
    return [
      ['id', 'in', visibleIds],
      ['type', 'in', ['consu', 'storable']],
      ...extra,
    ]
  }
  const publishedVisible = Array.from(settingsMap.keys()).filter(id => !hiddenIds.has(id))
  return [
    ['id', 'in', publishedVisible],
    ['type', 'in', ['consu', 'storable']],
    ...extra,
  ]
}

// Fetch published product settings via Next.js data cache — shared across all Vercel instances.
// Returns serializable [templateId, allowOos][] tuples (Maps aren't JSON-serializable).
// Costs ~1s to fetch thousands of rows from Odoo; cached so cold starts don't pay this cost.
const _fetchWebsiteSettings = unstable_cache(
  async (websiteId: number): Promise<[number, boolean][]> => {
    const sessionId = await getOdooSession()
    const settings = await callKw(
      sessionId,
      'product.website.settings',
      'search_read',
      [[['website_id', '=', websiteId], ['is_published', '=', true]]],
      { fields: ['product_tmpl_id', 'allow_out_of_stock_order'] },
    ) as unknown as OdooWebsiteSetting[]
    return settings.map(s => [s.product_tmpl_id[0], s.allow_out_of_stock_order])
  },
  ['odoo-website-settings'],
  { revalidate: 300, tags: ['odoo-website-settings'] },
)

export function bustWebsiteSettingsCache() {
  revalidateTag('odoo-website-settings')
  revalidateTag('odoo-hide-oos')
  revalidateTag('odoo-products')
}

export function bustCategoriesCache() { revalidateTag('odoo-categories') }

// Fetch the set of template IDs published on our website, plus their per-website OOS flag.
// This is the source of truth — product.template.website_published is global, not per-website.
export async function fetchWebsitePublishedSettings(_sessionId: string): Promise<Map<number, boolean>> {
  const raw = await _fetchWebsiteSettings(WEBSITE_ID)
  return new Map<number, boolean>(raw)
}

// Cache the set of in-stock template ids. Filtering by `qty_available > 0` inline is
// the single most expensive Odoo query in the product path (~600ms), because
// qty_available is a NON-STORED computed field, so Odoo recomputes live stock for the
// whole catalog on every cold request. We compute the in-stock id list once per short
// window (shared across all Vercel instances) and then filter the product query by a
// plain `id in [...]` list, which is ~60ms. Stock display becomes up to ~2 min stale,
// consistent with the 5-min product cache; checkout still validates real stock.
const _fetchInStockIds = unstable_cache(
  async (): Promise<number[]> => {
    const sessionId = await getOdooSession()
    // Odoo 18: physical products are all type `consu`; only `is_storable` ones track
    // inventory. Non-storable consumables always report qty_available = 0 but are
    // perpetually orderable, so they count as "in stock". A storable product is in stock
    // only when qty_available > 0. (`type in [consu, storable]` was a pre-18 relic —
    // `storable` is no longer a valid type value here.)
    return await callKw(sessionId, 'product.template', 'search',
      [['&', ['type', '=', 'consu'], '|', ['is_storable', '=', false], ['qty_available', '>', 0]]], {},
    ) as number[]
  },
  ['odoo-instock-ids'],
  { revalidate: 60, tags: ['odoo-instock-ids'] },
)

export function bustInStockCache() { revalidateTag('odoo-instock-ids') }

// Returns the set of in-stock template ids, or null if the lookup failed. Callers
// treat null as "stock unknown — do not hide on stock" so a transient failure shows
// products rather than emptying the catalog.
export async function getInStockIds(): Promise<Set<number> | null> {
  try {
    return new Set(await _fetchInStockIds())
  } catch {
    return null
  }
}

export function bustProductCache() { revalidateTag('odoo-products') }

// Given a set of template ids (e.g. the cart's), return the ones that can NOT currently be
// ordered: out of stock AND not flagged allow-out-of-stock on this website. Used to warn at
// checkout review and to hard-block at confirm, so an item that went OOS while a cart sat for
// days can't slip through. Returns an empty set when stock is unknown (fails open).
export async function findUnorderableTemplateIds(
  sessionId: string,
  templateIds: number[],
): Promise<Set<number>> {
  const out = new Set<number>()
  if (templateIds.length === 0) return out
  const [inStockIds, settingsMap] = await Promise.all([
    getInStockIds(),
    fetchWebsitePublishedSettings(sessionId),
  ])
  if (inStockIds === null) return out // stock lookup failed → don't block
  for (const tid of Array.from(new Set(templateIds))) {
    const allowOos = settingsMap.get(tid) ?? false
    if (!inStockIds.has(tid) && !allowOos) out.add(tid)
  }
  return out
}

// Cached per-uid "is this Odoo user still active?" check (revalidate 5 min). Lets the
// portal revoke a customer's access shortly after an admin deactivates them in Odoo,
// instead of waiting out the full session TTL. Fails OPEN (treats as active) on an
// Odoo error so a transient blip never logs everyone out.
const _fetchUidActive = unstable_cache(
  async (uid: number): Promise<boolean> => {
    const sessionId = await getOdooSession()
    const rows = await callKw(sessionId, 'res.users', 'read', [[uid]], { fields: ['active'] }) as { active: boolean }[]
    return rows[0]?.active === true
  },
  ['odoo-uid-active'],
  { revalidate: 300, tags: ['odoo-uid-active'] },
)
export async function isUidActive(uid: number): Promise<boolean> {
  try {
    return await _fetchUidActive(uid)
  } catch {
    return true
  }
}

// ─── Storefront rules (site_settings) ─────────────────────────────────────────
// Admin-tunable rules stored as JSON in `b2b_portal.site_settings`. Cached + shared
// like the other config params; the customer app reads these via /api/site-settings.
const SITE_SETTINGS_KEY = 'b2b_portal.site_settings'

const _fetchSiteSettings = unstable_cache(
  async (): Promise<SiteSettings> => {
    const sessionId = await getOdooSession()
    const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
      [[['key', '=', SITE_SETTINGS_KEY]]], { fields: ['value'], limit: 1 },
    ) as { value: string }[]
    if (!rows[0]?.value) return DEFAULT_SITE_SETTINGS
    try {
      return sanitizeSiteSettings(JSON.parse(rows[0].value))
    } catch {
      return DEFAULT_SITE_SETTINGS
    }
  },
  ['odoo-site-settings'],
  { revalidate: 300, tags: ['odoo-site-settings'] },
)

export function bustSiteSettingsCache() { revalidateTag('odoo-site-settings') }

// Returns the storefront rules, falling back to defaults if Odoo is unreachable.
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    return await _fetchSiteSettings()
  } catch {
    return DEFAULT_SITE_SETTINGS
  }
}

// Uncached read for the admin editor, so it always shows the true stored value.
export async function readSiteSettingsUncached(): Promise<SiteSettings> {
  const sessionId = await getOdooSession()
  const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
    [[['key', '=', SITE_SETTINGS_KEY]]], { fields: ['value'], limit: 1 },
  ) as { value: string }[]
  if (!rows[0]?.value) return DEFAULT_SITE_SETTINGS
  try {
    return sanitizeSiteSettings(JSON.parse(rows[0].value))
  } catch {
    return DEFAULT_SITE_SETTINGS
  }
}

// Persist the storefront rules (create-or-update) and bust the shared cache.
export async function writeSiteSettings(settings: SiteSettings): Promise<void> {
  const sessionId = await getOdooSession()
  await callKw(sessionId, 'ir.config_parameter', 'set_param',
    [SITE_SETTINGS_KEY, JSON.stringify(settings)], {},
  )
  bustSiteSettingsCache()
}

// ─── ID-list config params (featured / hidden products) ───────────────────────
// Both store an ordered/unordered list of template ids as a comma-separated string,
// mirroring the existing `hidden_category_ids` convention.
function parseIdList(value: string | undefined): number[] {
  return value ? value.split(',').map(Number).filter(Boolean) : []
}

async function readIdListParam(key: string): Promise<number[]> {
  const sessionId = await getOdooSession()
  const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
    [[['key', '=', key]]], { fields: ['value'], limit: 1 },
  ) as { value: string }[]
  return parseIdList(rows[0]?.value)
}

async function writeIdListParam(key: string, ids: number[]): Promise<void> {
  const sessionId = await getOdooSession()
  await callKw(sessionId, 'ir.config_parameter', 'set_param', [key, ids.join(',')], {})
}

const FEATURED_KEY = 'b2b_portal.featured_template_ids'
const HIDDEN_PRODUCTS_KEY = 'b2b_portal.hidden_product_ids'

// Featured: ordered list of promoted template ids (order is preserved and meaningful).
const _fetchFeaturedIds = unstable_cache(
  async (): Promise<number[]> => readIdListParam(FEATURED_KEY),
  ['odoo-featured'],
  { revalidate: 300, tags: ['odoo-featured'] },
)
export function bustFeaturedCache() { revalidateTag('odoo-featured') }
export async function getFeaturedIds(): Promise<number[]> {
  try { return await _fetchFeaturedIds() } catch { return [] }
}
export function readFeaturedIdsUncached() { return readIdListParam(FEATURED_KEY) }
export async function writeFeaturedIds(ids: number[]): Promise<void> {
  await writeIdListParam(FEATURED_KEY, ids)
  bustFeaturedCache()
}

// Hidden products: portal-level hide (order irrelevant), excluded from the listing.
const _fetchHiddenProductIds = unstable_cache(
  async (): Promise<number[]> => readIdListParam(HIDDEN_PRODUCTS_KEY),
  ['odoo-hidden-products'],
  { revalidate: 300, tags: ['odoo-hidden-products'] },
)
export function bustHiddenProductsCache() { revalidateTag('odoo-hidden-products'); revalidateTag('odoo-products') }
export async function getHiddenProductIds(): Promise<Set<number>> {
  try { return new Set(await _fetchHiddenProductIds()) } catch { return new Set() }
}
export function readHiddenProductIdsUncached() { return readIdListParam(HIDDEN_PRODUCTS_KEY) }
export async function writeHiddenProductIds(ids: number[]): Promise<void> {
  await writeIdListParam(HIDDEN_PRODUCTS_KEY, ids)
  bustHiddenProductsCache()
}

// Resolve the customer's effective (pricelist) price for an arbitrary set of templates and
// return a templateId -> price map. Shared by the price-sort ordering and best-sellers.
// Mirrors the listing resolver: global / category (via parent_path) / product / variant rules.
async function resolveEffectivePrices(
  sessionId: string,
  pricelistId: number,
  prods: OdooProduct[],
): Promise<Map<number, number>> {
  if (prods.length === 0) return new Map()
  const templateIds = prods.map(p => p.id)
  const variantIds = Array.from(new Set(prods.flatMap(p => p.product_variant_ids)))
  const items = await (callKw(sessionId, 'product.pricelist.item', 'search_read',
    [[
      '&', ['pricelist_id', '=', pricelistId],
      '|', '|', '|',
      ['applied_on', '=', '3_global'],
      ['applied_on', '=', '2_product_category'],
      '&', ['applied_on', '=', '1_product'], ['product_tmpl_id', 'in', templateIds],
      '&', ['applied_on', '=', '0_product_variant'], ['product_id', 'in', variantIds],
    ]],
    { fields: ['id', 'applied_on', 'product_tmpl_id', 'product_id', 'categ_id',
               'compute_price', 'percent_price', 'price_discount',
               'fixed_price', 'price_surcharge', 'min_quantity'] },
  ) as unknown as Promise<OdooPricelistItem[]>).catch(() => [] as OdooPricelistItem[])

  let categAncestors: Map<number, Set<number>> | undefined
  if (items.some(it => it.applied_on === '2_product_category')) {
    const prodCategIds = Array.from(new Set(
      prods.map(p => (Array.isArray(p.categ_id) ? p.categ_id[0] : 0)).filter(Boolean)
    ))
    if (prodCategIds.length > 0) {
      const cats = await callKw(sessionId, 'product.category', 'read', [prodCategIds],
        { fields: ['id', 'parent_path'] },
      ) as { id: number; parent_path: string | false }[]
      const ancestorByCateg = new Map<number, Set<number>>()
      for (const c of cats) {
        const ids = typeof c.parent_path === 'string'
          ? c.parent_path.split('/').filter(Boolean).map(Number)
          : [c.id]
        ancestorByCateg.set(c.id, new Set(ids))
      }
      categAncestors = new Map()
      for (const p of prods) {
        const cid = Array.isArray(p.categ_id) ? p.categ_id[0] : 0
        if (cid) categAncestors.set(p.id, ancestorByCateg.get(cid) ?? new Set([cid]))
      }
    }
  }

  const priceMap = buildPlPriceMap(prods, items, categAncestors)
  // Fill in list_price for products with no matching rule so every product has a price.
  const out = new Map<number, number>()
  for (const p of prods) out.set(p.id, priceMap.get(p.id) ?? p.list_price)
  return out
}

// All visible template ids ordered by the customer's effective price, ascending. Odoo can only
// sort by list_price (which doesn't match the displayed pricelist price), so we resolve every
// visible product's price once and cache the ordering per pricelist (price is language-neutral).
const _fetchPriceOrderedIds = unstable_cache(
  async (pricelistId: number): Promise<number[]> => {
    const sessionId = await getOdooSession()
    const [websiteSettingsMap, hideOos, inStockIds, hiddenIds] = await Promise.all([
      fetchWebsitePublishedSettings(sessionId),
      getHideOutOfStock(sessionId),
      getInStockIds(),
      getHiddenProductIds(),
    ])
    const domain = buildVisibilityDomain(websiteSettingsMap, hideOos, inStockIds, hiddenIds, [])
    const prods = await searchRead(sessionId, 'product.template', domain,
      ['id', 'list_price', 'categ_id', 'product_variant_ids'], {},
    ) as unknown as OdooProduct[]
    const priceMap = await resolveEffectivePrices(sessionId, pricelistId, prods)
    return prods
      .map(p => ({ id: p.id, price: priceMap.get(p.id) ?? p.list_price }))
      .sort((a, b) => a.price - b.price)
      .map(x => x.id)
  },
  ['odoo-price-ordered'],
  { revalidate: 600, tags: ['odoo-products'] },
)
export async function getPriceOrderedIds(pricelistId: number): Promise<number[]> {
  try { return await _fetchPriceOrderedIds(pricelistId) } catch { return [] }
}

// Best sellers: template ids ranked by how often they appear on confirmed/delivered order
// lines. `product_template_id` is not stored on sale.order.line, so we group by the stored
// `product_id` (variant) and roll the counts up to templates. Service lines (Delivery, etc.)
// rank high but get filtered out later by the storefront visibility rules. Cached 1h.
const _fetchBestSellerIds = unstable_cache(
  async (): Promise<number[]> => {
    const sessionId = await getOdooSession()
    const groups = await callKw(sessionId, 'sale.order.line', 'read_group',
      [[['order_id.state', 'in', ['sale', 'done']], ['product_id', '!=', false]]],
      { fields: ['product_id'], groupby: ['product_id'] },
    ) as { product_id: [number, string]; product_id_count: number }[]
    if (groups.length === 0) return []

    const variantIds = groups.map(g => g.product_id[0])
    const variants = await callKw(sessionId, 'product.product', 'read', [variantIds],
      { fields: ['product_tmpl_id'] },
    ) as { id: number; product_tmpl_id: [number, string] | false }[]
    const tmplOf = new Map(variants.map(v => [v.id, Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : 0]))

    const countByTmpl = new Map<number, number>()
    for (const g of groups) {
      const tmpl = tmplOf.get(g.product_id[0])
      if (!tmpl) continue
      countByTmpl.set(tmpl, (countByTmpl.get(tmpl) ?? 0) + (g.product_id_count ?? 0))
    }
    return Array.from(countByTmpl.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([id]) => id)
  },
  ['odoo-best-sellers'],
  { revalidate: 3600, tags: ['odoo-best-sellers'] },
)
export function bustBestSellersCache() { revalidateTag('odoo-best-sellers') }
export async function getBestSellerIds(): Promise<number[]> {
  try { return await _fetchBestSellerIds() } catch { return [] }
}

// Set a template's per-website published flag in product.website.settings (the
// source of truth for what's on this website), creating the row if absent. This is
// the "true publish" control; bust the website-settings cache so it takes effect.
export async function setProductPublished(templateId: number, published: boolean): Promise<void> {
  const sessionId = await getOdooSession()
  const existing = await callKw(sessionId, 'product.website.settings', 'search',
    [[['website_id', '=', WEBSITE_ID], ['product_tmpl_id', '=', templateId]]], { limit: 1 },
  ) as number[]
  if (existing.length > 0) {
    await callKw(sessionId, 'product.website.settings', 'write', [existing, { is_published: published }], {})
  } else {
    await callKw(sessionId, 'product.website.settings', 'create',
      [{ website_id: WEBSITE_ID, product_tmpl_id: templateId, is_published: published }], {},
    )
  }
  bustWebsiteSettingsCache()
}

// Product list results cached via the Next.js Data Cache (unstable_cache) — shared across
// ALL Vercel instances and surviving cold starts, unlike the previous per-instance Map.
// The Odoo admin session is fetched inside (not passed in) so the rotating session token
// never becomes part of the cache key. Keyed by domain + pagination + pricelist + lang +
// new-arrivals window via the serialized arguments. revalidate = 5 min; bust via tag.
const _fetchProductsCached = unstable_cache(
  async (
    domainJson: string,
    optsJson: string,
    pricelistId: number,       // 0 = no pricelist
    newArrivalsAfter: string,  // '' = not a new-arrivals query
    lang: 'en' | 'he' | 'both',
    inStockOnly: boolean,      // true = restrict to currently in-stock products
  ): Promise<{ products: Product[]; total: number }> => {
    const domain: unknown[] = JSON.parse(domainJson)
    const opts: { limit?: number; offset?: number; order?: string } = JSON.parse(optsJson)
    const sessionId = await getOdooSession()

    // Round 1: fetch website settings, hide-OOS toggle, the in-stock id set, and the
    // hidden id set in parallel — avoids a sequential preflight, and all four are
    // cached so cold requests rarely pay the full cost.
    const [websiteSettingsMap, hideOos, inStockIds, hiddenIds] = await Promise.all([
      fetchWebsitePublishedSettings(sessionId),
      getHideOutOfStock(sessionId),
      getInStockIds(),
      getHiddenProductIds(),
    ])
    if (websiteSettingsMap.size === 0) return { products: [], total: 0 }

    // New arrivals = products whose own template was created within the window.
    // (Previously keyed off product.website.settings.create_date — the publish date —
    // which silently empties after an Odoo DB import/migration bulk-stamps those
    // records with the import timestamp. The template create_date is the stable signal.)
    let effectiveDomain: unknown[] = domain
    // Stock intersection (shared by new-arrivals and the in-stock-only toggle): restrict to the
    // in-stock id set, which already counts non-storable consumables as always available.
    const stockTerm: unknown[] = inStockIds !== null ? [['id', 'in', Array.from(inStockIds)]] : []
    if (newArrivalsAfter) {
      // New arrivals = recently created AND currently in stock (owner's spec: "from when we
      // opened the product and it has stock"). Force the in-stock filter regardless of hide-OOS.
      effectiveDomain = [['create_date', '>=', newArrivalsAfter], ...stockTerm, ...domain]
    } else if (inStockOnly) {
      effectiveDomain = [...stockTerm, ...domain]
    }

    // Visibility rules (published + stock + admin hide) — shared with the search route.
    const baseDomain = buildVisibilityDomain(websiteSettingsMap, hideOos, inStockIds, hiddenIds, effectiveDomain)

    // The product listing renders one language at a time and refetches on language
    // switch, so reading both EN + HE is wasted Odoo work. Read the active language
    // only (numeric fields like price/packaging aren't translated, so the he_IL
    // context still returns correct data). 'both' keeps the old dual-read for callers
    // that need EN as canonical alongside HE.
    const fetchBoth = lang === 'both'
    const primaryLang = lang === 'he' ? 'he_IL' : 'en_US'

    // Run count + primary read (+ HE read only when 'both') all in parallel.
    const [count, primaryRaw, heRaw] = await Promise.all([
      callKw(sessionId, 'product.template', 'search_count', [baseDomain], {}) as Promise<number>,
      searchRead(sessionId, 'product.template', baseDomain, PRODUCT_FIELDS, {
        ...opts, context: { lang: primaryLang }
      }) as unknown as Promise<OdooProduct[]>,
      fetchBoth
        ? searchRead(sessionId, 'product.template', baseDomain, ['id', 'name', 'description_sale'], {
            ...opts, context: { lang: 'he_IL' }
          }) as unknown as Promise<{ id: number; name: string; description_sale: string | false }[]>
        : Promise.resolve([] as { id: number; name: string; description_sale: string | false }[]),
    ])

    if (primaryRaw.length === 0) return { products: [], total: count }

    const heMap = new Map(heRaw.map(p => [p.id, p]))

    // Derive all IDs needed for the next batch from the primary read
    const templateIds = primaryRaw.map(p => p.id)
    const variantIds = Array.from(new Set(primaryRaw.flatMap(p => p.product_variant_ids)))
    const allPackagingIds = Array.from(new Set(primaryRaw.flatMap(p => p.packaging_ids)))
    const allTaxIds = Array.from(new Set(primaryRaw.flatMap(p => p.taxes_id)))
    const allCatIds = Array.from(new Set(primaryRaw.flatMap(p => p.public_categ_ids)))

    // Fetch pricelist items, packagings, taxes, and categories all in parallel.
    // Categories are read once in the primary language (+ HE only when 'both').
    const [rawPlItems, packagings, taxes, primaryCats, heCats] = await Promise.all([
      pricelistId && templateIds.length > 0
        ? (callKw(
            sessionId,
            'product.pricelist.item',
            'search_read',
            // Fetch every rule type that can apply to this page: global + all category rules
            // (few), plus per-template and per-variant rules scoped to the page's ids.
            [[
              '&',
              ['pricelist_id', '=', pricelistId],
              '|', '|', '|',
              ['applied_on', '=', '3_global'],
              ['applied_on', '=', '2_product_category'],
              '&', ['applied_on', '=', '1_product'], ['product_tmpl_id', 'in', templateIds],
              '&', ['applied_on', '=', '0_product_variant'], ['product_id', 'in', variantIds],
            ]],
            { fields: ['id', 'applied_on', 'product_tmpl_id', 'product_id', 'categ_id',
                       'compute_price', 'percent_price', 'price_discount',
                       'fixed_price', 'price_surcharge', 'min_quantity'] },
          ) as unknown as Promise<OdooPricelistItem[]>).catch((err) => {
            console.warn('Pricelist item fetch failed, falling back to list_price:', err)
            return [] as OdooPricelistItem[]
          })
        : Promise.resolve([] as OdooPricelistItem[]),
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
            fields: ['id', 'name'], context: { lang: primaryLang }
          }) as unknown as Promise<{ id: number; name: string }[]>
        : Promise.resolve([] as { id: number; name: string }[]),
      fetchBoth && allCatIds.length > 0
        ? callKw(sessionId, 'product.public.category', 'read', [allCatIds], {
            fields: ['id', 'name'], context: { lang: 'he_IL' }
          }) as unknown as Promise<{ id: number; name: string }[]>
        : Promise.resolve([] as { id: number; name: string }[]),
    ])

    // Category pricelist rules match a product whose internal category is the rule's category
    // or a descendant. Resolve ancestor sets from product.category.parent_path, but only when
    // this pricelist actually has category rules (keeps the common per-product path at 0 extra calls).
    let categAncestors: Map<number, Set<number>> | undefined
    if (rawPlItems.some(it => it.applied_on === '2_product_category')) {
      const prodCategIds = Array.from(new Set(
        primaryRaw.map(p => (Array.isArray(p.categ_id) ? p.categ_id[0] : 0)).filter(Boolean)
      ))
      if (prodCategIds.length > 0) {
        const cats = await callKw(sessionId, 'product.category', 'read', [prodCategIds],
          { fields: ['id', 'parent_path'] },
        ) as { id: number; parent_path: string | false }[]
        const ancestorByCateg = new Map<number, Set<number>>()
        for (const c of cats) {
          const ids = typeof c.parent_path === 'string'
            ? c.parent_path.split('/').filter(Boolean).map(Number)
            : [c.id]
          ancestorByCateg.set(c.id, new Set(ids))
        }
        categAncestors = new Map()
        for (const prod of primaryRaw) {
          const cid = Array.isArray(prod.categ_id) ? prod.categ_id[0] : 0
          if (cid) categAncestors.set(prod.id, ancestorByCateg.get(cid) ?? new Set([cid]))
        }
      }
    }

    const plPriceMap = new Map<number, number>()
    buildPlPriceMap(primaryRaw, rawPlItems, categAncestors).forEach((price, id) => plPriceMap.set(id, price))

    const packMap = new Map(packagings.map(p => [p.id, p]))
    const taxMap = new Map(taxes.map(t => [t.id, t]))
    const primaryCatMap = new Map(primaryCats.map(c => [c.id, c]))
    // When not reading HE separately, the primary-language names stand in for both.
    const heCatMap = fetchBoth ? new Map(heCats.map(c => [c.id, c])) : primaryCatMap

    const products: Product[] = primaryRaw.map(raw => {
      // In single-language mode the primary read already holds the right names, so the
      // HE-specific fields fall back to it; in 'both' mode we use the dedicated HE read.
      const he = fetchBoth ? heMap.get(raw.id) : raw

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

    // When both a price-inclusive and price-exclusive tax exist at the same rate (e.g. 7%
    // incl + 7% excl), they cancel each other: incl strips 7% from base, excl adds 7% back.
    // In practice the customer's fiscal position removes the excl tax so the customer pays
    // exactly the list_price / pricelist price. Drop the excl tax to avoid double-counting.
    const inclAmounts = new Set(uniqueTaxes.filter(t => t.price_include).map(t => t.amount))
    const effectiveTaxes = uniqueTaxes.filter(t => t.price_include || !inclAmounts.has(t.amount))

    const inclRate = effectiveTaxes.filter(t => t.price_include).reduce((s, t) => s + t.amount, 0)
    const exclRate = effectiveTaxes.filter(t => !t.price_include).reduce((s, t) => s + t.amount, 0)
    const taxNames = Array.from(new Set(effectiveTaxes.map(t => t.name)))

    // Use pricelist price when available; fall back to list_price.
    const basePrice = plPriceMap.get(raw.id) ?? raw.list_price
    // back-compute excl-tax price if taxes are price_include
    const unitPriceExcl = inclRate > 0
      ? Math.round(basePrice / (1 + inclRate / 100) * 100) / 100
      : basePrice
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

    // Derive in_stock from the SAME in-stock id set that drives visibility, so the grid can
    // never show a product as "out of stock" that it only displayed because it was considered
    // in stock (and vice-versa). The set already treats non-storable consumables as always
    // available. Fall back to the fresh qty only if the stock lookup failed (set is null).
    const inStock = inStockIds === null ? raw.qty_available > 0 : inStockIds.has(raw.id)
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
      // 512 (not 256): grid cards are ~300px, which needs ~600px source on retina.
      // Odoo returns the smaller rendition if 512 isn't available. Still AVIF + edge-cached.
      image_url: `/api/images/product/${raw.id}/512`,
      categories: raw.public_categ_ids.map(cid => ({
        id: cid,
        name: primaryCatMap.get(cid)?.name ?? '',
        name_he: heCatMap.get(cid)?.name ?? '',
      })),
      uom_name: raw.uom_id[1] ?? '',
      packaging_options: packagingOptions,
      currency: 'THB',
      tax_display: 'incl_tax',
      tax_names: taxNames,
      sellable,
      in_stock: inStock,
      qty_available: raw.qty_available,
    }
  })

    return { products, total: count }
  },
  ['odoo-products'],
  { revalidate: 300, tags: ['odoo-products'] },
)

// Public entry point. `lang` selects which language(s) to read from Odoo:
//   'en' / 'he' — read only that language (the product listing refetches on switch);
//   'both'      — read EN as canonical plus HE (default, for callers that need both).
// `sessionId` is accepted for backward compatibility but is no longer used here — the
// cached implementation fetches its own admin session so the rotating token stays out
// of the cache key.
export async function fetchOdooProducts(
  _sessionId: string,
  domain: unknown[],
  opts: { limit?: number; offset?: number; order?: string } = {},
  pricelistId?: number | null,
  newArrivalsAfter?: string,
  lang: 'en' | 'he' | 'both' = 'both',
  inStockOnly = false,
): Promise<{ products: Product[]; total: number }> {
  return _fetchProductsCached(
    JSON.stringify(domain),
    JSON.stringify(opts),
    pricelistId ?? 0,
    newArrivalsAfter ?? '',
    lang,
    inStockOnly,
  )
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

  // Build parent→children map once (O(n)) instead of filtering the array per node (O(n²))
  const childMap = new Map<number | null, typeof visible>()
  for (const c of visible) {
    const pid = c.parent_id ? c.parent_id[0] : null
    if (!childMap.has(pid)) childMap.set(pid, [])
    childMap.get(pid)!.push(c)
  }

  const buildTree = (parentId: number | null): CategoryNode[] =>
    (childMap.get(parentId) ?? []).map(c => ({
      id: c.id,
      name: c.name,
      name_he: heMap.get(c.id)?.name ?? c.name,
      parent_id: parentId,
      children: buildTree(c.id),
    }))

  return buildTree(null)
}

// ─── Cart helpers ─────────────────────────────────────────────────────────────

async function readCartLines(sessionId: string, orderId: number): Promise<CartLine[]> {
  const rawLines = await searchRead(sessionId, 'sale.order.line', [['order_id', '=', orderId]], [
    'id', 'product_id', 'product_template_id', 'product_packaging_id',
    'product_packaging_qty', 'product_uom_qty', 'price_unit',
    'price_subtotal', 'price_total', 'name', 'display_type',
  ]) as unknown as (OdooCartLine & { display_type: string | false; product_id: [number, string] | false; product_template_id: [number, string] | false })[]

  // Drop section/note lines (display_type set, no product) that staff may add to
  // the draft quotation in the Odoo backoffice — they are not cart items.
  const lines = rawLines.filter(l => !l.display_type && Array.isArray(l.product_id) && Array.isArray(l.product_template_id)) as unknown as OdooCartLine[]

  // Read the real Hebrew name and SKU per variant so server reconciliation matches
  // the optimistic line (which seeds name_he + sku from the product). Without this
  // the cart flips Hebrew names to English on reconcile and shows a blank SKU.
  const variantIds = Array.from(new Set(lines.map(l => l.product_id[0])))
  const variantInfo = new Map<number, { name_he: string; sku: string }>()
  if (variantIds.length > 0) {
    const heRows = await callKw(sessionId, 'product.product', 'read', [variantIds], {
      fields: ['id', 'display_name', 'default_code'],
      context: { lang: 'he_IL' },
    }) as { id: number; display_name: string; default_code: string | false }[]
    heRows.forEach(r => variantInfo.set(r.id, { name_he: r.display_name, sku: r.default_code || '' }))
  }

  return lines.map(line => {
    const packagingId = line.product_packaging_id ? line.product_packaging_id[0] : 0
    const info = variantInfo.get(line.product_id[0])
    // Customer-facing per-pack price must be TAX-INCLUSIVE: product cards, the
    // optimistic cart line (cartStore.addLineOptimistic), and the displayed line
    // total (price_total) are all inc-VAT. Deriving from price_unit (ex-VAT) made
    // the cart look wrong (pack price × qty ≠ line total). Divide Odoo's own
    // inc-VAT line total by the number of packs so the math always reconciles.
    const packs = line.product_packaging_qty || line.product_uom_qty || 1
    const price_per_pack = Math.round((line.price_total / packs) * 100) / 100

    return {
      line_id: line.id,
      product_id: line.product_id[0],
      template_id: line.product_template_id[0],
      product_name: line.product_template_id[1] ?? line.name,
      product_name_he: info?.name_he ?? line.product_template_id[1] ?? line.name,
      product_image_url: `/api/images/product/${line.product_template_id[0]}/128`,
      sku: info?.sku ?? '',
      packaging_id: packagingId,
      packaging_name: line.product_packaging_id ? line.product_packaging_id[1] : 'Unit',
      packaging_qty: line.product_packaging_qty,
      unit_qty: line.product_uom_qty,
      price_unit: line.price_unit,
      price_per_pack,
      price_subtotal: line.price_subtotal,
      price_total: line.price_total,
      warnings: [],
    }
  })
}

export async function readCart(sessionId: string, orderId: number): Promise<Cart> {
  // Fetch order header and lines in parallel
  const [orders, lines] = await Promise.all([
    callKw(sessionId, 'sale.order', 'read', [[orderId]], {
      fields: ['id', 'name', 'state', 'partner_shipping_id', 'note', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id'],
    }) as unknown as Promise<OdooOrder[]>,
    readCartLines(sessionId, orderId),
  ])

  const order = orders[0]
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
  // Only pick up portal-created carts (website_id match) that are less than 7 days old.
  // Without this, stale manually-created quotations from months ago get reused as carts.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const carts = await searchRead(sessionId, 'sale.order',
    [
      ['partner_id', '=', partnerId],
      ['state', '=', 'draft'],
      ['website_id', '=', WEBSITE_ID],
      ['date_order', '>=', sevenDaysAgo],
    ],
    ['id'],
    { limit: 1, order: 'id desc' },
  ) as unknown as { id: number }[]
  return carts[0]?.id ?? null
}

export async function getOrCreateCart(
  sessionId: string,
  partnerId: number,
): Promise<number> {
  const existing = await findCart(sessionId, partnerId)
  if (existing) return existing

  // Do NOT set pricelist_id — Odoo derives it from the partner's current
  // property_product_pricelist on create. This keeps the cart on the customer's live
  // pricelist (no stale cookie, no re-login) and lets Odoo compute line price_unit natively.
  const createVals: Record<string, unknown> = {
    partner_id: partnerId,
    website_id: WEBSITE_ID,
  }

  const orderId = await callKw(sessionId, 'sale.order', 'create', [createVals], {}) as number

  // Race guard: the optimistic UI fires adds without awaiting, so two concurrent
  // first-adds can each pass the findCart(null) check and each create a cart —
  // then findCart (id desc) would only ever return the newer one, stranding the
  // other's line. Converge everyone on the OLDEST draft portal cart: if an earlier
  // one exists, adopt it and unlink the one we just created (still empty here,
  // since callers add the line only after this returns).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const drafts = await searchRead(sessionId, 'sale.order',
    [
      ['partner_id', '=', partnerId],
      ['state', '=', 'draft'],
      ['website_id', '=', WEBSITE_ID],
      ['date_order', '>=', sevenDaysAgo],
    ],
    ['id'],
    { limit: 1, order: 'id asc' },
  ) as unknown as { id: number }[]

  const canonicalId = drafts[0]?.id ?? orderId
  if (canonicalId !== orderId) {
    try {
      await callKw(sessionId, 'sale.order', 'unlink', [[orderId]], {})
    } catch {
      // Best-effort cleanup of the duplicate; a leftover empty draft is harmless
      // once findCart converges on the older canonical cart via readCart.
    }
    return canonicalId
  }
  return orderId
}

// Snapshot an order's product lines for a scheduled order: variant id, quantities,
// packaging, plus EN/HE names + SKU (so the management UI can render without an
// Odoo round-trip). Prices are intentionally NOT captured — the executor lets Odoo
// compute the live pricelist price at placement.
export async function readOrderItemsForSchedule(sessionId: string, orderId: number): Promise<import('@/lib/scheduled-orders').ScheduledOrderItem[]> {
  const rawLines = await searchRead(sessionId, 'sale.order.line', [['order_id', '=', orderId]], [
    'id', 'product_id', 'product_packaging_id', 'product_packaging_qty', 'product_uom_qty', 'display_type',
  ]) as unknown as {
    display_type: string | false
    product_id: [number, string] | false
    product_packaging_id: [number, string] | false
    product_packaging_qty: number
    product_uom_qty: number
  }[]

  const lines = rawLines.filter(l => !l.display_type && Array.isArray(l.product_id))
  const variantIds = Array.from(new Set(lines.map(l => (l.product_id as [number, string])[0])))
  if (variantIds.length === 0) return []

  const [enRows, heRows] = await Promise.all([
    callKw(sessionId, 'product.product', 'read', [variantIds], {
      fields: ['id', 'display_name', 'default_code'], context: { lang: 'en_US' },
    }) as Promise<{ id: number; display_name: string; default_code: string | false }[]>,
    callKw(sessionId, 'product.product', 'read', [variantIds], {
      fields: ['id', 'display_name'], context: { lang: 'he_IL' },
    }) as Promise<{ id: number; display_name: string }[]>,
  ])
  const enMap = new Map(enRows.map(r => [r.id, r]))
  const heMap = new Map(heRows.map(r => [r.id, r.display_name]))

  return lines.map(l => {
    const variantId = (l.product_id as [number, string])[0]
    const en = enMap.get(variantId)
    return {
      product_id: variantId,
      name: en?.display_name ?? '',
      name_he: heMap.get(variantId) ?? en?.display_name ?? '',
      sku: en?.default_code || '',
      uom_qty: l.product_uom_qty,
      packaging_id: l.product_packaging_id ? l.product_packaging_id[0] : null,
      packaging_qty: l.product_packaging_qty,
    }
  })
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

// Validate that an order belongs to this partner (security check).
// NOTE: sale.order has NO `commercial_partner_id` field on this Odoo — reading it throws and
// made every order-detail view return ORDER_NOT_FOUND. Ownership is verified the same way the
// orders list does it: a `partner_id child_of <commercialPartnerId>` domain search, which
// matches the commercial partner and every child contact in its hierarchy.
export async function assertOrderOwnership(
  sessionId: string,
  orderId: number,
  commercialPartnerId: number,
): Promise<OdooOrder> {
  const [orders, owned] = await Promise.all([
    callKw(sessionId, 'sale.order', 'read', [[orderId]], {
      fields: ['id', 'partner_id', 'state', 'name',
        'partner_shipping_id', 'note', 'client_order_ref', 'commitment_date',
        'amount_untaxed', 'amount_tax', 'amount_total',
        'currency_id', 'date_order', 'order_line'],
    }) as unknown as Promise<OdooOrder[]>,
    callKw(sessionId, 'sale.order', 'search_count',
      [[['id', '=', orderId], ['partner_id', 'child_of', commercialPartnerId]]], {},
    ) as Promise<number>,
  ])

  const order = orders[0]
  if (!order || !owned) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' })

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
    const variants = await searchRead(sessionId, 'product.product',
      [['product_tmpl_id', '=', templateId]],
      ['id'],
      { limit: 1 },
    ) as unknown as { id: number }[]
    return variants[0] ? { qty: 1, productVariantId: variants[0].id } : null
  }

  // Single call: domain path validates template membership, filters sales=true
  const pkgs = await searchRead(sessionId, 'product.packaging',
    [['id', '=', packagingId], ['product_id.product_tmpl_id', '=', templateId], ['sales', '=', true]],
    ['id', 'qty', 'product_id'],
    { limit: 1 },
  ) as unknown as { id: number; qty: number; product_id: [number, string] }[]

  const pkg = pkgs[0]
  if (!pkg) return null
  return { qty: pkg.qty, productVariantId: pkg.product_id[0] }
}
