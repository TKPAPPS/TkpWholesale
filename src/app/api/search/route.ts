import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import type { SearchHit } from '@/types'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
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
    const { fetchWebsitePublishedSettings, getHideOutOfStock, buildVisibilityDomain } = await import('@/lib/odoo/odoo-helpers')

    // Resolve visibility rules first (both cached) so the name/sku search itself
    // is restricted to published + in-stock products — same rules as the listing,
    // so hidden out-of-stock products never appear in search.
    const [websiteMap, hideOos] = await Promise.all([
      fetchWebsitePublishedSettings(sessionId),
      getHideOutOfStock(sessionId),
    ])

    // Round 1: search EN (name OR sku) + HE (name), both AND-ed with the
    // visibility domain. '|' is a sibling of the two leaves, not nested in an
    // extra list — Odoo rejects the nested form with "Invalid field ...|".
    const skuDomain = ['default_code', 'ilike', q]
    const enDomain = buildVisibilityDomain(websiteMap, hideOos, ['|', ['name', 'ilike', q], skuDomain])
    const heDomain = buildVisibilityDomain(websiteMap, hideOos, [['name', 'ilike', q]])
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

    // Cap to 20 IDs — the overlay shows 6; fetching 100 templates for 6 results wastes bandwidth
    const topIds = allIds.slice(0, 20)

    // Round 2: template details (EN + HE) in parallel — skips pricelist, categories,
    // hide-OOS, and the full tax pipeline. Price shown is list_price × packaging qty
    // (a preview, not pricelist-adjusted).
    const [enTemplates, heTemplates] = await Promise.all([
      callKw(sessionId, 'product.template', 'read', [topIds],
        { fields: ['id', 'name', 'default_code', 'list_price', 'packaging_ids'] },
      ) as Promise<{ id: number; name: string; default_code: string | false; list_price: number; packaging_ids: number[] }[]>,
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

    const results: SearchHit[] = enTemplates.map(t => {
      const salesPkgs = t.packaging_ids
        .map(id => packMap.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p && p.sales)

      // price_per_pack_incl_tax here is list_price × qty — a preview price only,
      // not pricelist-adjusted and not guaranteed to be tax-inclusive.
      const packagingOptions = salesPkgs.map((pkg, idx) => ({
        id: pkg.id,
        name: pkg.name,
        qty: pkg.qty,
        price_per_pack_incl_tax: Math.round(t.list_price * pkg.qty * 100) / 100,
        is_default: idx === 0,
      }))

      if (packagingOptions.length === 0) {
        packagingOptions.push({ id: 0, name: 'Unit', qty: 1, price_per_pack_incl_tax: t.list_price, is_default: true })
      }

      return {
        id: t.id,
        template_id: t.id,
        name: t.name,
        name_he: heMap.get(t.id) ?? t.name,
        sku: t.default_code || '',
        image_url: `/api/images/product/${t.id}/128`,
        currency: 'THB',
        packaging_options: packagingOptions,
      }
    })

    return NextResponse.json({ results, query: q, total: allIds.length })
  } catch (err) {
    invalidateOdooSession()
    console.error('search error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
