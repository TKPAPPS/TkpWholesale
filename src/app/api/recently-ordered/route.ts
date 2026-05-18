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
    const { fetchOdooProducts } = await import('@/lib/odoo/odoo-helpers')

    // Find recently ordered product template IDs from confirmed orders
    const lines = await searchRead(sessionId, 'sale.order.line',
      [['order_id.partner_id', 'child_of', parsed.commercial_partner_id],
       ['order_id.state', 'in', ['sale', 'done']]],
      ['product_template_id'],
      { limit: 50, order: 'id desc' },
    ) as { product_template_id: [number, string] }[]

    // Deduplicate, keep order (most recent first), take top 8
    const seen = new Set<number>()
    const recentTemplateIds: number[] = []
    for (const l of lines) {
      const tid = l.product_template_id[0]
      if (!seen.has(tid)) {
        seen.add(tid)
        recentTemplateIds.push(tid)
      }
      if (recentTemplateIds.length >= 8) break
    }

    if (recentTemplateIds.length === 0) {
      return NextResponse.json({ products: [] })
    }

    const { products } = await fetchOdooProducts(
      sessionId,
      [['id', 'in', recentTemplateIds]],
      { limit: 8 },
      parsed.pricelist_id ?? undefined,
    )

    // Re-sort to match recency order
    const idxMap = new Map(recentTemplateIds.map((id, i) => [id, i]))
    products.sort((a, b) => (idxMap.get(a.id) ?? 99) - (idxMap.get(b.id) ?? 99))

    return NextResponse.json({ products: products.slice(0, 4) })
  } catch (err) {
    invalidateOdooSession()
    console.error('recently-ordered error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
