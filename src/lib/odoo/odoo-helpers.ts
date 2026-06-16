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

function buildPlPriceMap(products: OdooProduct[], items: OdooPricelistItem[]): Map<number, number> {
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

export function bustHideOosCache() { revalidateTag('odoo-hide-oos') }

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
  extra: unknown[] = [],
): unknown[] {
  if (hideOos) {
    // Resolve stock in JS against the cached in-stock set instead of via a
    // `qty_available > 0` SQL term (which forces Odoo to compute live stock for the
    // whole catalog, ~600ms). The result is a single `id in [...]` list — ~60ms.
    // Show a product if it allows OOS ordering, or it's in stock. If the in-stock set
    // is unavailable (null), don't filter on stock so a transient failure shows the
    // catalog rather than emptying it.
    const visibleIds: number[] = []
    settingsMap.forEach((allowOos, id) => {
      if (allowOos || inStockIds === null || inStockIds.has(id)) visibleIds.push(id)
    })
    return [
      ['id', 'in', visibleIds],
      ['type', 'in', ['consu', 'storable']],
      ...extra,
    ]
  }
  return [
    ['id', 'in', Array.from(settingsMap.keys())],
    ['type', 'in', ['consu', 'storable']],
    ...extra,
  ]
}

export async function fetchRecentlyPublishedIds(sessionId: string, publishedAfter: string): Promise<number[]> {
  const rows = await callKw(sessionId, 'product.website.settings', 'search_read',
    [[['website_id', '=', WEBSITE_ID], ['is_published', '=', true], ['create_date', '>=', publishedAfter]]],
    { fields: ['product_tmpl_id'] },
  ) as unknown as { product_tmpl_id: [number, string] }[]
  return rows.map(r => r.product_tmpl_id[0])
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
    return await callKw(sessionId, 'product.template', 'search',
      [[['qty_available', '>', 0], ['type', 'in', ['consu', 'storable']]]], {},
    ) as number[]
  },
  ['odoo-instock-ids'],
  { revalidate: 120, tags: ['odoo-instock-ids'] },
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
export function bustHiddenProductsCache() { revalidateTag('odoo-hidden-products') }
export async function getHiddenProductIds(): Promise<Set<number>> {
  try { return new Set(await _fetchHiddenProductIds()) } catch { return new Set() }
}
export function readHiddenProductIdsUncached() { return readIdListParam(HIDDEN_PRODUCTS_KEY) }
export async function writeHiddenProductIds(ids: number[]): Promise<void> {
  await writeIdListParam(HIDDEN_PRODUCTS_KEY, ids)
  bustHiddenProductsCache()
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
  ): Promise<{ products: Product[]; total: number }> => {
    const domain: unknown[] = JSON.parse(domainJson)
    const opts: { limit?: number; offset?: number; order?: string } = JSON.parse(optsJson)
    const sessionId = await getOdooSession()

    // Round 1: fetch website settings, hide-OOS toggle, the in-stock id set, and (if
    // new_arrivals) recently published IDs all in parallel — avoids a sequential
    // preflight, and all four are cached so cold requests rarely pay the full cost.
    const [websiteSettingsMap, hideOos, inStockIds, recentIds] = await Promise.all([
      fetchWebsitePublishedSettings(sessionId),
      getHideOutOfStock(sessionId),
      getInStockIds(),
      newArrivalsAfter ? fetchRecentlyPublishedIds(sessionId, newArrivalsAfter) : Promise.resolve(null),
    ])
    if (websiteSettingsMap.size === 0) return { products: [], total: 0 }

    // Merge new-arrivals ID filter into the caller's domain
    let effectiveDomain: unknown[] = domain
    if (recentIds && recentIds.length > 0) {
      effectiveDomain = [['id', 'in', recentIds], ...domain]
    }

    // Visibility rules (published + stock) — shared with the search route.
    const baseDomain = buildVisibilityDomain(websiteSettingsMap, hideOos, inStockIds, effectiveDomain)

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
            [[
              ['pricelist_id', '=', pricelistId],
              '|',
              ['applied_on', '=', '3_global'],
              ['product_tmpl_id', 'in', templateIds],
            ]],
            { fields: ['id', 'applied_on', 'product_tmpl_id', 'product_id',
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

    const plPriceMap = new Map<number, number>()
    buildPlPriceMap(primaryRaw, rawPlItems).forEach((price, id) => plPriceMap.set(id, price))

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
      image_url: `/api/images/product/${raw.id}/256`,
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
): Promise<{ products: Product[]; total: number }> {
  return _fetchProductsCached(
    JSON.stringify(domain),
    JSON.stringify(opts),
    pricelistId ?? 0,
    newArrivalsAfter ?? '',
    lang,
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
  const lines = await searchRead(sessionId, 'sale.order.line', [['order_id', '=', orderId]], [
    'id', 'product_id', 'product_template_id', 'product_packaging_id',
    'product_packaging_qty', 'product_uom_qty', 'price_unit',
    'price_subtotal', 'price_total', 'name',
  ]) as unknown as OdooCartLine[]

  // Fetch units-per-package for every packaging used in this order.
  // Using product.packaging.qty (e.g. 12 for "Case of 12") is the only
  // unambiguous way to compute the package price regardless of how
  // product_packaging_qty is stored on the order line.
  const packagingIds = lines
    .map(l => l.product_packaging_id ? l.product_packaging_id[0] : 0)
    .filter(Boolean)

  const unitsPerPackMap = new Map<number, number>()
  if (packagingIds.length > 0) {
    const pkgs = await callKw(sessionId, 'product.packaging', 'read',
      [packagingIds],
      { fields: ['id', 'qty'] },
    ) as { id: number; qty: number }[]
    pkgs.forEach(p => unitsPerPackMap.set(p.id, p.qty))
  }

  return lines.map(line => {
    const packagingId = line.product_packaging_id ? line.product_packaging_id[0] : 0
    const unitsPerPack = unitsPerPackMap.get(packagingId) ?? 1
    // price_unit is price per individual UOM unit; multiply by units per pack
    // to get the customer-facing package price (what they pay per box/case/etc.)
    const price_per_pack = Math.round(line.price_unit * unitsPerPack * 100) / 100

    return {
      line_id: line.id,
      product_id: line.product_id[0],
      template_id: line.product_template_id[0],
      product_name: line.product_template_id[1] ?? line.name,
      product_name_he: line.product_template_id[1] ?? line.name,
      product_image_url: `/api/images/product/${line.product_template_id[0]}/128`,
      sku: '',
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
