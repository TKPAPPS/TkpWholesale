import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import type { Product } from '@/types'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

interface InputItem { sku: string; qty: number }

// Resolve a pasted SKU+qty list to orderable products. Body: { items: [{sku, qty}], lang }.
// Returns matched products (full Product shape, visibility + pricelist applied) keyed to the
// requested qty, plus the SKUs we couldn't match (not found / not available). The client then
// adds the matched rows to the quick-order table. SKUs are matched case-insensitively against
// product.template.default_code (TKP codes are uppercase, e.g. DRY-0548).
export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const rawItems: unknown = body?.items
  const lang = body?.lang === 'he' ? 'he' : 'en'
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'No items provided.' }, { status: 400 })
  }

  // Normalize + cap. Keep the requested qty per SKU (last one wins on duplicates).
  const qtyBySku = new Map<string, number>()
  for (const it of (rawItems as InputItem[]).slice(0, 300)) {
    const sku = String(it?.sku ?? '').trim().toUpperCase()
    const qty = Math.max(1, Math.floor(Number(it?.qty) || 1))
    if (sku) qtyBySku.set(sku, qty)
  }
  const skus = Array.from(qtyBySku.keys())
  if (skus.length === 0) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'No valid SKUs.' }, { status: 400 })
  }

  if (USE_MOCK) {
    return NextResponse.json({ matched: [], unmatched: skus })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const sessionId = await getOdooSession()
    const { fetchOdooProducts, getPartnerPricelistId } = await import('@/lib/odoo/odoo-helpers')
    const pricelistId = (await getPartnerPricelistId(parsed.partner_id)) ?? parsed.pricelist_id ?? undefined

    // Visibility + pricelist applied by fetchOdooProducts; limit covers the requested set.
    const { products } = await fetchOdooProducts(
      sessionId,
      [['default_code', 'in', skus]],
      { limit: skus.length },
      pricelistId,
      undefined,
      lang,
    )

    const bySku = new Map<string, Product>()
    for (const p of products) {
      if (p.sku) bySku.set(p.sku.toUpperCase(), p)
    }

    const matched: { sku: string; qty: number; product: Product }[] = []
    const unmatched: string[] = []
    for (const sku of skus) {
      const product = bySku.get(sku)
      if (product) matched.push({ sku, qty: qtyBySku.get(sku)!, product })
      else unmatched.push(sku)
    }

    return NextResponse.json({ matched, unmatched })
  } catch (err) {
    invalidateOdooSession()
    console.error('bulk-order error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
