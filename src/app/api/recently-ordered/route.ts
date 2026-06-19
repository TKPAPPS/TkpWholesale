import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json({ products: MOCK_PRODUCTS.filter((p) => p.sellable).slice(0, 4) })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { searchRead } = await import('@/lib/odoo/client')
    const { fetchOdooProducts, getPartnerPricelistId } = await import('@/lib/odoo/odoo-helpers')

    // Find recently ordered product template IDs from confirmed orders. Scan more lines so we
    // can surface a fuller reorder history (the customer may reorder many of the same items).
    const lines = await searchRead(sessionId, 'sale.order.line',
      [['order_id.partner_id', 'child_of', parsed.commercial_partner_id],
       ['order_id.state', 'in', ['sale', 'done']]],
      ['product_template_id'],
      { limit: 200, order: 'id desc' },
    ) as { product_template_id: [number, string] }[]

    // Deduplicate, keep order (most recent first), take the top distinct products
    const MAX_RECENT = 24
    const seen = new Set<number>()
    const recentTemplateIds: number[] = []
    for (const l of lines) {
      const tid = l.product_template_id[0]
      if (!seen.has(tid)) {
        seen.add(tid)
        recentTemplateIds.push(tid)
      }
      if (recentTemplateIds.length >= MAX_RECENT) break
    }

    if (recentTemplateIds.length === 0) {
      return NextResponse.json({ products: [] })
    }

    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined
    const { products } = await fetchOdooProducts(
      sessionId,
      [['id', 'in', recentTemplateIds]],
      { limit: MAX_RECENT },
      pricelistId,
    )

    // Re-sort to match recency order (most recently ordered first)
    const idxMap = new Map(recentTemplateIds.map((id, i) => [id, i]))
    products.sort((a, b) => (idxMap.get(a.id) ?? 1e9) - (idxMap.get(b.id) ?? 1e9))

    return NextResponse.json({ products })
  } catch (err) {
    invalidateOdooSession()
    console.error('recently-ordered error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
