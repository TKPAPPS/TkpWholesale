import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'
import { readHiddenProductIdsUncached, writeHiddenProductIds, setProductPublished } from '@/lib/odoo/odoo-helpers'
import { readJsonObject } from '@/lib/request-body'

const WEBSITE_ID = Number(process.env.ODOO_WEBSITE_ID ?? 3)

async function gate(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  return !!token && !!(await verifyAdminToken(token))
}

// Search products and report their per-website published + portal-hidden state.
export async function GET(req: NextRequest) {
  if (!(await gate(req))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ results: [] })

  try {
    const sessionId = await getAdminSession()
    const rows = await callKw(sessionId, 'product.template', 'search_read',
      [['|', ['name', 'ilike', q], ['default_code', 'ilike', q]]],
      { fields: ['id', 'name', 'default_code'], limit: 20, order: 'name asc' },
    ) as { id: number; name: string; default_code: string | false }[]

    const ids = rows.map(r => r.id)
    const hiddenSet = new Set(await readHiddenProductIdsUncached())
    const pubRows = ids.length > 0
      ? await callKw(sessionId, 'product.website.settings', 'search_read',
          [[['website_id', '=', WEBSITE_ID], ['product_tmpl_id', 'in', ids], ['is_published', '=', true]]],
          { fields: ['product_tmpl_id'] },
        ) as { product_tmpl_id: [number, string] }[]
      : []
    const publishedSet = new Set(pubRows.map(r => r.product_tmpl_id[0]))

    return NextResponse.json({
      results: rows.map(r => ({
        id: r.id,
        name: r.name,
        sku: r.default_code || '',
        published: publishedSet.has(r.id),
        hidden: hiddenSet.has(r.id),
      })),
    })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin products GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}

// Toggle a single product's portal-hidden flag and/or its per-website publish state.
export async function POST(req: NextRequest) {
  if (!(await gate(req))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const { id, hidden, published } = await readJsonObject(req)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'INVALID_ID', message: 'id must be a positive integer.' }, { status: 400 })
    }

    if (typeof hidden === 'boolean') {
      const set = new Set(await readHiddenProductIdsUncached())
      if (hidden) set.add(id)
      else set.delete(id)
      await writeHiddenProductIds(Array.from(set))
    }
    if (typeof published === 'boolean') {
      await setProductPublished(id, published)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin products POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
