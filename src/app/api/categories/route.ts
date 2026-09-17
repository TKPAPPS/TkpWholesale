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
    // The tree STRUCTURE is cached 5 min (it rarely changes). Emptiness tracks STOCK, which
    // moves far faster, so the populated-set + prune runs outside that cache (its own ~2 min
    // cache, busted by stock/publish changes). A category with no currently-visible product -
    // everything out of stock, unpublished, or hidden - is dropped so customers stop clicking
    // into empty categories. pruneEmptyCategories fails open: if the populated set is unknown,
    // the full tree is returned rather than risk emptying the nav.
    const { getPopulatedCategoryIds, pruneEmptyCategories } = await import('@/lib/odoo/odoo-helpers')
    const [fullTree, populated] = await Promise.all([_fetchCategories(), getPopulatedCategoryIds()])
    const categories = pruneEmptyCategories(fullTree, populated)
    return NextResponse.json({ categories }, {
      headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=60' },
    })
  } catch (err) {
    invalidateOdooSession()
    console.error('categories error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
