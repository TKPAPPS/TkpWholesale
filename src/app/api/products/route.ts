import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

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
    const { fetchOdooProducts, fetchRecentlyPublishedIds } = await import('@/lib/odoo/odoo-helpers')

    const domain: unknown[] = []
    if (categoryId) domain.push(['public_categ_ids', 'child_of', categoryId])

    // For new arrivals, filter by when the product was published to our website
    // (product.website.settings.create_date), not the template's create_date.
    if (sort === 'new_arrivals' && createdAfter) {
      const recentIds = await fetchRecentlyPublishedIds(parsed.odoo_session_id, createdAfter)
      if (recentIds.length > 0) domain.push(['id', 'in', recentIds])
    } else if (createdAfter) {
      domain.push(['create_date', '>=', createdAfter])
    }

    const odooSort =
      sort === 'price'            ? 'list_price asc' :
      sort === 'new_arrivals'     ? 'create_date desc' :
      sort === 'recently_ordered' ? 'name asc' :
      'name asc'

    const { products, total } = await fetchOdooProducts(
      parsed.odoo_session_id,
      domain,
      { limit: perPage, offset: page * perPage, order: odooSort },
      parsed.pricelist_id ?? undefined,
    )

    return NextResponse.json({ products, total, page, per_page: perPage })
  } catch (err) {
    console.error('products error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
