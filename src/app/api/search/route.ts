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
    const { fetchWebsitePublishedSettings } = await import('@/lib/odoo/odoo-helpers')

    // Round 1: search EN + HE + fetch published IDs (cached) in parallel
    const skuDomain = ['default_code', 'ilike', q]
    const [enResults, heResults, websiteMap] = await Promise.all([
      searchRead(sessionId, 'product.template',
        [['|', ['name', 'ilike', q], skuDomain]],
        ['id'], { limit: 50, context: { lang: 'en_US' } },
      ) as Promise<{ id: number }[]>,
      searchRead(sessionId, 'product.template',
        [['name', 'ilike', q]],
        ['id'], { limit: 50, context: { lang: 'he_IL' } },
      ) as Promise<{ id: number }[]>,
      fetchWebsitePublishedSettings(sessionId),
    ])

    // Deduplicate and filter to only published products
    const publishedIds = new Set(websiteMap.keys())
    const idSet = new Set<number>()
    enResults.forEach((p: { id: number }) => { if (publishedIds.has(p.id)) idSet.add(p.id) })
    heResults.forEach((p: { id: number }) => { if (publishedIds.has(p.id)) idSet.add(p.id) })
    const allIds = Array.from(idSet)

    if (allIds.length === 0) return NextResponse.json({ results: [], query: q, total: 0 })

    // Round 2: template details + Hebrew names + packagings in parallel
    // Skips pricelist lookup, categories, hide-OOS, and full tax pipeline —
    // the search overlay only shows name, SKU, and a price preview.
    const [enTemplates, heTemplates] = await Promise.all([
      callKw(sessionId, 'product.template', 'read', [allIds],
        { fields: ['id', 'name', 'default_code', 'list_price', 'packaging_ids', 'taxes_id'] },
      ) as Promise<{ id: number; name: string; default_code: string | false; list_price: number; packaging_ids: number[]; taxes_id: number[] }[]>,
      callKw(sessionId, 'product.template', 'read', [allIds],
        { fields: ['id', 'name'], context: { lang: 'he_IL' } },
      ) as Promise<{ id: number; name: string }[]>,
    ])

    const heMap = new Map(heTemplates.map(t => [t.id, t.name]))

    // Collect all packaging IDs and fetch in one call
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

    return NextResponse.json({ results, query: q, total: results.length })
  } catch (err) {
    invalidateOdooSession()
    console.error('search error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
