import { NextRequest, NextResponse } from 'next/server'
import { MOCK_PRODUCTS } from '@/lib/odoo/mock/data'

const mockFavorites = new Set([10, 11])

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  // TODO (Phase 2): query Supabase favorites table by partner_id, then validate each product against Odoo visibility
  const favorites = MOCK_PRODUCTS.filter((p) => mockFavorites.has(p.id) && p.sellable)
  return NextResponse.json({ favorites })
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const { template_id } = await req.json()
  mockFavorites.add(template_id)
  return NextResponse.json({ added: true, template_id })
}
