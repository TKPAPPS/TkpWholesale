import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import type { SearchHit } from '@/types'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  // Cap length (docs/security-rules.md: max 100 chars) before it reaches the two
  // ilike domains, so an oversized query can't force huge pattern scans on Odoo.
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100)
  if (!q) return NextResponse.json({ results: [], query: q, total: 0 })

  if (USE_MOCK) {
    const lower = q.toLowerCase()
    const results = MOCK_PRODUCTS.filter(
      (p) => p.sellable && (p.name.toLowerCase().includes(lower) || p.name_he.includes(q) || p.sku.toLowerCase().includes(lower)),
    )
    return NextResponse.json({ results, query: q, total: results.length })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { searchRead, callKw } = await import('@/lib/odoo/client')
    const { fetchWebsitePublishedSettings, getHideOutOfStock, getInStockIds, getHiddenProductIds, getHiddenCategoryIds, getCustomerHiddenDomain, buildVisibilityDomain, stockLocationContext, getPartnerFiscalPositionId, getFiscalTaxMap, getWebsiteCompanyId, computeDisplayUnitPrice } = await import('@/lib/odoo/odoo-helpers')

    // Resolve visibility rules first (all cached) so the name/sku search itself
    // is restricted to published + in-stock + not-admin-hidden products - same rules
    // as the listing. Stock is resolved against the cached in-stock id set, not a
    // slow `qty_available` SQL term. locCtx scopes the per-hit qty_available read below
    // to the sellable location (R4/Stock), same as the listing.
    const [websiteMap, hideOos, inStockIds, hiddenIds, hiddenCategoryIds, locCtx, fiscalPositionId, websiteCompanyId] = await Promise.all([
      fetchWebsitePublishedSettings(sessionId),
      getHideOutOfStock(sessionId),
      getInStockIds(),
      getHiddenProductIds(),
      getHiddenCategoryIds(),
      stockLocationContext(),
      getPartnerFiscalPositionId(parsed.partner_id),
      getWebsiteCompanyId(),
    ])
    // Fiscal-position tax map so search prices match the grid (e.g. NO VAT -> ex-VAT price).
    const fiscalMap = await getFiscalTaxMap(fiscalPositionId)

    // Round 1: search EN (name OR sku) + HE (name), both AND-ed with the
    // visibility domain. '|' is a sibling of the two leaves, not nested in an
    // extra list - Odoo rejects the nested form with "Invalid field ...|".
    // Per-customer hidden products/categories exclude their matches from search too.
    const custHidden = await getCustomerHiddenDomain(parsed.partner_id, parsed.commercial_partner_id)
    const skuDomain = ['default_code', 'ilike', q]
    const enDomain = buildVisibilityDomain(websiteMap, hideOos, inStockIds, hiddenIds, ['|', ['name', 'ilike', q], skuDomain, ...custHidden], hiddenCategoryIds)
    const heDomain = buildVisibilityDomain(websiteMap, hideOos, inStockIds, hiddenIds, [['name', 'ilike', q], ...custHidden], hiddenCategoryIds)
    const [enResults, heResults] = await Promise.all([
      searchRead(sessionId, 'product.template', enDomain,
        ['id'], { limit: 50, context: { lang: 'en_US' } },
      ) as Promise<{ id: number }[]>,
      searchRead(sessionId, 'product.template', heDomain,
        ['id'], { limit: 50, context: { lang: 'he_IL' } },
      ) as Promise<{ id: number }[]>,
    ])

    // Deduplicate (results are already published + in-stock-visible via the domain)
    const idSet = new Set<number>()
    enResults.forEach((p: { id: number }) => idSet.add(p.id))
    heResults.forEach((p: { id: number }) => idSet.add(p.id))
    const allIds = Array.from(idSet)

    if (allIds.length === 0) return NextResponse.json({ results: [], query: q, total: 0 })

    // Cap to 20 IDs - the overlay shows 6; fetching 100 templates for 6 results wastes bandwidth
    const topIds = allIds.slice(0, 20)

    // Round 2: template details (EN + HE) in parallel - skips pricelist, categories,
    // hide-OOS, and the full tax pipeline. Price shown is list_price × packaging qty
    // (a preview, not pricelist-adjusted).
    const [enTemplates, heTemplates] = await Promise.all([
      callKw(sessionId, 'product.template', 'read', [topIds],
        { fields: ['id', 'name', 'default_code', 'list_price', 'packaging_ids', 'qty_available', 'taxes_id'], context: locCtx },
      ) as Promise<{ id: number; name: string; default_code: string | false; list_price: number; packaging_ids: number[]; qty_available: number; taxes_id: number[] }[]>,
      callKw(sessionId, 'product.template', 'read', [topIds],
        { fields: ['id', 'name'], context: { lang: 'he_IL' } },
      ) as Promise<{ id: number; name: string }[]>,
    ])

    const heMap = new Map(heTemplates.map(t => [t.id, t.name]))

    // Round 3: fetch all packagings for the matched templates in one call
    const packagingIds = Array.from(new Set(enTemplates.flatMap(t => t.packaging_ids)))
    const packagings = packagingIds.length > 0
      ? await callKw(sessionId, 'product.packaging', 'read', [packagingIds],
          { fields: ['id', 'name', 'qty', 'product_id', 'sales'] },
        ) as { id: number; name: string; qty: number; product_id: [number, string]; sales: boolean }[]
      : []

    const packMap = new Map(packagings.map(p => [p.id, p]))

    // Taxes for the matched templates → fiscal-position-aware unit price (same helper as the
    // grid), so a NO-VAT customer sees the ex-VAT price here too. Still list_price-based (not
    // pricelist-adjusted) - a preview.
    const allTaxIds = Array.from(new Set(enTemplates.flatMap(t => t.taxes_id)))
    const taxRows = allTaxIds.length > 0
      ? await callKw(sessionId, 'account.tax', 'read', [allTaxIds],
          { fields: ['id', 'name', 'amount', 'price_include', 'company_id'] },
        ) as { id: number; name: string; amount: number; price_include: boolean; company_id: [number, string] | false }[]
      : []
    const taxMap = new Map(taxRows.map(t => [t.id, t]))

    const results: SearchHit[] = enTemplates.map(t => {
      const salesPkgs = t.packaging_ids
        .map(id => packMap.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p && p.sales)

      const productTaxes = t.taxes_id.map(id => taxMap.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
      const { incl: unitPrice } = computeDisplayUnitPrice(t.list_price, productTaxes, fiscalMap, websiteCompanyId)
      const packagingOptions = salesPkgs.map((pkg, idx) => ({
        id: pkg.id,
        name: pkg.name,
        qty: pkg.qty,
        price_per_pack_incl_tax: Math.round(unitPrice * pkg.qty * 100) / 100,
        price_per_unit_incl_tax: unitPrice,
        is_default: idx === 0,
      }))

      if (packagingOptions.length === 0) {
        packagingOptions.push({ id: 0, name: 'Unit', qty: 1, price_per_pack_incl_tax: unitPrice, price_per_unit_incl_tax: unitPrice, is_default: true })
      }

      // Stock flags derived the same way as the listing: in_stock from the cached
      // (location-scoped) in-stock set, sellable also true when the product is flagged
      // allow_out_of_stock_order. This is what fixes OOS items rendering as in-stock and
      // in-stock items rendering as OOS on the search-driven surfaces.
      const in_stock = inStockIds === null ? t.qty_available > 0 : inStockIds.has(t.id)
      const sellable = in_stock || (websiteMap.get(t.id) ?? false)

      return {
        id: t.id,
        template_id: t.id,
        name: t.name,
        name_he: heMap.get(t.id) ?? t.name,
        sku: t.default_code || '',
        // 512 to match the listing grid - search results render in the same
        // ProductCard cards, so 128 looked noticeably blurry beside listing.
        image_url: `/api/images/product/${t.id}/512`,
        currency: 'THB',
        packaging_options: packagingOptions,
        sellable,
        in_stock,
        qty_available: t.qty_available,
      }
    })

    return NextResponse.json({ results, query: q, total: allIds.length })
  } catch (err) {
    invalidateOdooSession()
    console.error('search error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
