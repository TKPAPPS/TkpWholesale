import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

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
    const { fetchWebsitePublishedSettings, getHideOutOfStock, getInStockIds, getHiddenProductIds, getHiddenCategoryIds, getCustomerHiddenDomain, buildVisibilityDomain, getPartnerFiscalPositionId, getPartnerPricelistId, fetchOdooProducts } = await import('@/lib/odoo/odoo-helpers')

    // Resolve visibility rules first (all cached) so the name/sku search itself
    // is restricted to published + in-stock + not-admin-hidden products - same rules
    // as the listing. Stock is resolved against the cached in-stock id set, not a
    // slow `qty_available` SQL term. locCtx scopes the per-hit qty_available read below
    // to the sellable location (R4/Stock), same as the listing.
    // These feed the id-matching domain below. Tax/company/fiscal-map resolution is no longer
    // done here: hydration goes through fetchOdooProducts, which owns that pipeline.
    const [websiteMap, hideOos, inStockIds, hiddenIds, hiddenCategoryIds, fiscalPositionId] = await Promise.all([
      fetchWebsitePublishedSettings(sessionId),
      getHideOutOfStock(sessionId),
      getInStockIds(),
      getHiddenProductIds(),
      getHiddenCategoryIds(),
      getPartnerFiscalPositionId(parsed.partner_id),
    ])

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

    // Round 2: hydrate through the SAME pipeline the grid uses, rather than a second
    // hand-rolled payload builder.
    //
    // This route used to read templates itself and price them from list_price, calling the
    // result "a preview". The card cannot show a preview: /products drops these straight into
    // its Product[] state and renders them in the identical ProductCard, so a customer whose
    // pricelist differs from list_price saw one price on the card and another in the cart.
    // The same divergence had already produced a second bug, where an allow-OOS product came
    // back without its flag and its Add button was disabled only when reached via search.
    //
    // One builder means the two surfaces cannot disagree again: pricelist, fiscal position,
    // packaging, taxes, categories, stock flags and the freshness overlay are all resolved
    // exactly once, in fetchOdooProducts. It is also fewer Odoo calls than the four this
    // route used to make, since that function is cached per (domain, pricelist, lang).
    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined
    const { products } = await fetchOdooProducts(
      sessionId, [['id', 'in', topIds]], { limit: topIds.length }, pricelistId,
      undefined, 'both', false, fiscalPositionId,
    )

    // Re-impose relevance order: fetchOdooProducts sorts by its own default, but the ids came
    // out of the name/SKU match above and that ordering is what the customer expects.
    const rank = new Map(topIds.map((id, i) => [id, i]))
    products.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))

    const results = products
    return NextResponse.json({ results, query: q, total: allIds.length })
  } catch (err) {
    invalidateOdooSession()
    console.error('search error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
