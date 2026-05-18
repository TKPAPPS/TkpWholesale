import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CATEGORIES } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

// Categories change rarely — cache for 5 minutes per serverless instance
let _cache: { data: unknown; expires: number } | null = null

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json({ categories: MOCK_CATEGORIES })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (_cache && Date.now() < _cache.expires) {
    return NextResponse.json(_cache.data)
  }

  try {
    const { fetchOdooCategories } = await import('@/lib/odoo/odoo-helpers')
    const categories = await fetchOdooCategories(parsed.odoo_session_id)
    const data = { categories }
    _cache = { data, expires: Date.now() + 5 * 60_000 }
    return NextResponse.json(data)
  } catch (err) {
    console.error('categories error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
