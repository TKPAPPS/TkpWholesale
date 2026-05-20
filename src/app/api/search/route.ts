import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

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
    const { fetchOdooProducts } = await import('@/lib/odoo/odoo-helpers')
    const { searchRead } = await import('@/lib/odoo/client')

    // Search both English and Hebrew name fields in parallel, plus SKU
    const skuDomain = ['default_code', 'ilike', q]
    const [enResults, heResults] = await Promise.all([
      searchRead(sessionId, 'product.template',
        [['|', ['name', 'ilike', q], skuDomain]],
        ['id'], { limit: 50, context: { lang: 'en_US' } },
      ) as Promise<{ id: number }[]>,
      searchRead(sessionId, 'product.template',
        [['name', 'ilike', q]],
        ['id'], { limit: 50, context: { lang: 'he_IL' } },
      ) as Promise<{ id: number }[]>,
    ])

    // Deduplicate IDs from both language searches
    const idMap: Record<number, true> = {}
    enResults.forEach((p) => { idMap[p.id] = true })
    heResults.forEach((p) => { idMap[p.id] = true })
    const allIds = Object.keys(idMap).map(Number)

    if (allIds.length === 0) return NextResponse.json({ results: [], query: q, total: 0 })

    const { products, total } = await fetchOdooProducts(
      sessionId,
      [['id', 'in', allIds]],
      { limit: 50 },
      parsed.pricelist_id ?? undefined,
    )

    return NextResponse.json({ results: products, query: q, total })
  } catch (err) {
    invalidateOdooSession()
    console.error('search error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
