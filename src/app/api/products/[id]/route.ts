import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const id = Number(params.id)

  if (USE_MOCK) {
    const product = MOCK_PRODUCTS.find((p) => p.id === id)
    if (!product) return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
    return NextResponse.json(product)
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { fetchOdooProducts, getPartnerPricelistId, getCustomerHiddenDomain, getPartnerFiscalPositionId } = await import('@/lib/odoo/odoo-helpers')
    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined
    const fiscalPositionId = await getPartnerFiscalPositionId(parsed.partner_id)
    // Per-customer hidden products/categories: a hidden product returns empty -> 404, so a
    // customer can't open one via a direct link either.
    const custHidden = await getCustomerHiddenDomain(parsed.partner_id, parsed.commercial_partner_id)
    const { products } = await fetchOdooProducts(
      sessionId, [['id', '=', id], ...custHidden], { limit: 1 }, pricelistId, undefined, undefined, false, fiscalPositionId,
    )

    if (products.length === 0) {
      return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json(products[0])
  } catch (err) {
    invalidateOdooSession()
    console.error('product detail error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
