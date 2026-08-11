import { NextRequest, NextResponse } from 'next/server'
import { MOCK_CATEGORIES } from '@/lib/odoo/mock/data'
import { parseSession } from '@/lib/odoo/session'
import { getOdooSession, invalidateOdooSession } from '@/lib/odoo/admin-session'
import { unstable_cache, revalidateTag } from 'next/cache'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

// Categories change rarely - shared across all Vercel instances via Data Cache.
// Follows the same pattern as _fetchWebsiteSettings in odoo-helpers.ts.
const _fetchCategories = unstable_cache(
  async () => {
    const sessionId = await getOdooSession()
    const { fetchOdooCategories } = await import('@/lib/odoo/odoo-helpers')
    return fetchOdooCategories(sessionId)
  },
  ['odoo-categories'],
  { revalidate: 300, tags: ['odoo-categories'] },
)


export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (USE_MOCK) {
    return NextResponse.json({ categories: MOCK_CATEGORIES })
  }

  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  try {
    const categories = await _fetchCategories()
    return NextResponse.json({ categories }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('categories error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
