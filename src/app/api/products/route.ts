import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { parsePagination } from '@/lib/pagination'
import { isIsoDate } from '@/lib/schedule-dates'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const categoryId = searchParams.get('category_id') ? Number(searchParams.get('category_id')) : null
  const { page, perPage, offset } = parsePagination(searchParams, 24)
  const sort = searchParams.get('sort') ?? 'name'
  const createdAfter = searchParams.get('created_after') ?? null   // ISO date string e.g. 2025-05-01
  // An empty value is treated as absent, not as invalid: `?created_after=` was previously
  // ignored (the falsy check below skips the domain term), so rejecting it would be a
  // regression rather than a fix. Same rule as date_from/date_to on the orders route.
  if (createdAfter !== null && createdAfter !== '' && !isIsoDate(createdAfter)) {
    return NextResponse.json({ error: 'INVALID_DATE', message: 'created_after must be YYYY-MM-DD.' }, { status: 400 })
  }
  const lang = searchParams.get('lang') === 'he' ? 'he' : 'en'     // read only the active language
  const inStockOnly = searchParams.get('in_stock_only') === '1'

  if (USE_MOCK) {
    let products = MOCK_PRODUCTS.filter((p) => p.sellable || !p.in_stock)
    if (categoryId) products = products.filter((p) => p.categories.some((c) => c.id === categoryId))
    if (sort === 'price') {
      products = [...products].sort((a, b) => a.packaging_options[0].price_per_pack_incl_tax - b.packaging_options[0].price_per_pack_incl_tax)
    } else {
      products = [...products].sort((a, b) => a.name.localeCompare(b.name))
    }
    const total = products.length
    return NextResponse.json({ products: products.slice(offset, offset + perPage), total, page, per_page: perPage })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { fetchOdooProducts, getPartnerPricelistId, getPriceOrderedIds, getInStockIds, getCustomerHiddenIds, getPartnerFiscalPositionId } = await import('@/lib/odoo/odoo-helpers')
    const { searchRead } = await import('@/lib/odoo/client')

    // Resolve the partner's CURRENT pricelist (cached) rather than trusting the login-time
    // cookie value, so changing a customer's pricelist in Odoo takes effect without re-login.
    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined
    // Customer's fiscal position (e.g. NO VAT) so card prices match what Odoo charges them.
    const fiscalPositionId = await getPartnerFiscalPositionId(parsed.partner_id)

    // Per-customer hidden products/categories (Odoo res.partner customization). Build domain
    // terms to exclude them from the grid for this customer.
    const custHidden = await getCustomerHiddenIds(parsed.partner_id, parsed.commercial_partner_id)
    const custHiddenTerms: unknown[] = []
    if (custHidden.productIds.length) custHiddenTerms.push(['id', 'not in', custHidden.productIds])
    if (custHidden.categoryIds.length) custHiddenTerms.push('!', ['public_categ_ids', 'child_of', custHidden.categoryIds])

    // PRICE SORT: the grid shows the pricelist price, but Odoo can only sort by list_price, so a
    // naive sort looks "mixed". Order by the resolved effective price instead (cached per
    // pricelist), optionally intersected with the selected category, then page by id.
    const isPriceSort = sort === 'price' || sort === 'price_asc' || sort === 'price_desc'
    if (isPriceSort && pricelistId) {
      const asc = await getPriceOrderedIds(pricelistId)
      let ordered = sort === 'price_desc' ? [...asc].reverse() : asc
      if (categoryId) {
        // limit: 0 = no cap. Otherwise searchRead defaults to 100, silently
        // dropping products from categories larger than 100 and shrinking total.
        const catRows = await searchRead(sessionId, 'product.template',
          [['public_categ_ids', 'child_of', categoryId]], ['id'], { limit: 0 },
        ) as { id: number }[]
        const catSet = new Set(catRows.map(c => c.id))
        ordered = ordered.filter(id => catSet.has(id))
      }
      if (inStockOnly) {
        const ins = await getInStockIds()
        if (ins) ordered = ordered.filter(id => ins.has(id))
      }
      // Drop the customer's hidden products + products in their hidden category subtree,
      // before paging, so `total` and the page are both correct.
      if (custHidden.productIds.length || custHidden.categoryIds.length) {
        const excl = new Set<number>(custHidden.productIds)
        if (custHidden.categoryIds.length) {
          const rows = await searchRead(sessionId, 'product.template',
            [['public_categ_ids', 'child_of', custHidden.categoryIds]], ['id'], { limit: 0 },
          ) as { id: number }[]
          rows.forEach(r => excl.add(r.id))
        }
        if (excl.size) ordered = ordered.filter(id => !excl.has(id))
      }
      const total = ordered.length
      const pageIds = ordered.slice(offset, offset + perPage)
      if (pageIds.length === 0) {
        return NextResponse.json({ products: [], total, page, per_page: perPage })
      }
      const { products } = await fetchOdooProducts(
        sessionId, [['id', 'in', pageIds]], { limit: perPage }, pricelistId, undefined, lang, false, fiscalPositionId,
      )
      // Re-impose the price order (fetchOdooProducts sorts by its own default).
      const idx = new Map(pageIds.map((id, i) => [id, i]))
      products.sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9))
      return NextResponse.json({ products, total, page, per_page: perPage }, {
        headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
      })
    }

    const domain: unknown[] = [...custHiddenTerms]
    if (categoryId) domain.push(['public_categ_ids', 'child_of', categoryId])

    // For non-new-arrivals createdAfter, filter by product template create_date directly.
    // For new_arrivals, fetchOdooProducts applies the same create_date window internally.
    if (createdAfter && sort !== 'new_arrivals') {
      domain.push(['create_date', '>=', createdAfter])
    }

    // Default ('sku') orders by default_code, which is language-independent, so switching
    // language keeps the same products in the same positions (only labels translate). The
    // 'name' option is an explicit, localized alphabetical sort (Odoo orders by the active
    // language's translated name), so that one intentionally reshuffles per language.
    // (Price sort is handled above; the list_price fallbacks here only apply with no pricelist.)
    const odooSort =
      sort === 'price_desc'       ? 'list_price desc' :
      sort === 'price' || sort === 'price_asc' ? 'list_price asc' :
      sort === 'new_arrivals'     ? 'create_date desc' :
      sort === 'recently_ordered' ? 'default_code asc, id asc' :
      sort === 'name'             ? 'name asc' :
      'default_code asc, id asc'

    const { products, total } = await fetchOdooProducts(
      sessionId,
      domain,
      { limit: perPage, offset, order: odooSort },
      pricelistId,
      sort === 'new_arrivals' && createdAfter ? createdAfter : undefined,
      lang,
      inStockOnly,
      fiscalPositionId,
    )

    return NextResponse.json({ products, total, page, per_page: perPage }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('products error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
