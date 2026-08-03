import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

// Featured products for the storefront strip. Returns the admin-curated templates,
// filtered to those currently visible (published + in stock), in the admin's order.
export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const lang = req.nextUrl.searchParams.get('lang') === 'he' ? 'he' : 'en'

  if (USE_MOCK) {
    return NextResponse.json({ products: MOCK_PRODUCTS.filter((p) => p.sellable).slice(0, 4) })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { getFeaturedIds, fetchOdooProducts, getPartnerPricelistId, getCustomerHiddenDomain } = await import('@/lib/odoo/odoo-helpers')
    const ids = await getFeaturedIds()
    if (ids.length === 0) return NextResponse.json({ products: [] })

    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined
    const custHidden = await getCustomerHiddenDomain(parsed.partner_id, parsed.commercial_partner_id)
    const { products } = await fetchOdooProducts(
      sessionId,
      [['id', 'in', ids], ...custHidden],
      { limit: ids.length },
      pricelistId,
      undefined,
      lang,
    )

    // Preserve the admin-defined order (fetchOdooProducts sorts by name).
    const order = new Map(ids.map((id, i) => [id, i]))
    products.sort((a, b) => (order.get(a.template_id) ?? 1e9) - (order.get(b.template_id) ?? 1e9))

    return NextResponse.json({ products }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('featured error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
