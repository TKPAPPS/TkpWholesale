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
    const { fetchOdooProducts } = await import('@/lib/odoo/odoo-helpers')
    const { products } = await fetchOdooProducts(
      sessionId, [['id', '=', id]], { limit: 1 }, parsed.pricelist_id ?? undefined,
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
