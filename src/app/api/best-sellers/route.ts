import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

// Best sellers for the storefront strip. Ranked by confirmed-order frequency (computed in
// getBestSellerIds), then filtered to currently-visible products (published + in stock) and
// returned in rank order. Service lines (Delivery, etc.) rank high but drop out of visibility.
export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const lang = req.nextUrl.searchParams.get('lang') === 'he' ? 'he' : 'en'
  // Strip uses the default (12); the dedicated /best-sellers page requests more.
  const rawLimit = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 12

  if (USE_MOCK) {
    return NextResponse.json({ products: MOCK_PRODUCTS.filter((p) => p.sellable).slice(0, limit) })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { getBestSellerIds, fetchOdooProducts, getPartnerPricelistId } = await import('@/lib/odoo/odoo-helpers')
    const ids = await getBestSellerIds()
    if (ids.length === 0) return NextResponse.json({ products: [] })

    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined
    const { products } = await fetchOdooProducts(
      sessionId,
      [['id', 'in', ids]],
      { limit: ids.length },
      pricelistId,
      undefined,
      lang,
    )

    // Preserve the best-seller rank order (fetchOdooProducts sorts by its own default), then
    // cap to a strip-sized list of currently-visible best sellers.
    const order = new Map(ids.map((id, i) => [id, i]))
    products.sort((a, b) => (order.get(a.template_id) ?? 1e9) - (order.get(b.template_id) ?? 1e9))

    return NextResponse.json({ products: products.slice(0, limit) }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('best-sellers error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
