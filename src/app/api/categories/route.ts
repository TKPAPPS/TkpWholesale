import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CATEGORIES } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json({ categories: MOCK_CATEGORIES })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const { fetchOdooCategories } = await import('@/lib/odoo/odoo-helpers')
    const categories = await fetchOdooCategories(parsed.odoo_session_id)
    return NextResponse.json({ categories })
  } catch (err) {
    console.error('categories error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
