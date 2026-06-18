import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const categoryId = searchParams.get('category_id') ? Number(searchParams.get('category_id')) : null
  const page = Number(searchParams.get('page') ?? 0)
  const perPage = Number(searchParams.get('per_page') ?? 24)
  const sort = searchParams.get('sort') ?? 'name'
  const createdAfter = searchParams.get('created_after') ?? null   // ISO date string e.g. 2025-05-01
  const lang = searchParams.get('lang') === 'he' ? 'he' : 'en'     // read only the active language

  if (USE_MOCK) {
    let products = MOCK_PRODUCTS.filter((p) => p.sellable || !p.in_stock)
    if (categoryId) products = products.filter((p) => p.categories.some((c) => c.id === categoryId))
    if (sort === 'price') {
      products = [...products].sort((a, b) => a.packaging_options[0].price_per_pack_incl_tax - b.packaging_options[0].price_per_pack_incl_tax)
    } else {
      products = [...products].sort((a, b) => a.name.localeCompare(b.name))
    }
    const total = products.length
    return NextResponse.json({ products: products.slice(page * perPage, page * perPage + perPage), total, page, per_page: perPage })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { fetchOdooProducts } = await import('@/lib/odoo/odoo-helpers')

    const domain: unknown[] = []
    if (categoryId) domain.push(['public_categ_ids', 'child_of', categoryId])

    // For non-new-arrivals createdAfter, filter by product template create_date directly.
    // For new_arrivals, fetchOdooProducts applies the same create_date window internally.
    if (createdAfter && sort !== 'new_arrivals') {
      domain.push(['create_date', '>=', createdAfter])
    }

    const odooSort =
      sort === 'price'            ? 'list_price asc' :
      sort === 'new_arrivals'     ? 'create_date desc' :
      sort === 'recently_ordered' ? 'name asc' :
      'name asc'

    const { products, total } = await fetchOdooProducts(
      sessionId,
      domain,
      { limit: perPage, offset: page * perPage, order: odooSort },
      parsed.pricelist_id ?? undefined,
      sort === 'new_arrivals' && createdAfter ? createdAfter : undefined,
      lang,
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
