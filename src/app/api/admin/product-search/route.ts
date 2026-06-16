import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'

// Admin-authed product lookup by name or SKU. Used by the Featured and Product
// management pages as a picker (the customer /api/search needs a customer session).
export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ results: [] })

  try {
    const sessionId = await getAdminSession()
    const rows = await callKw(sessionId, 'product.template', 'search_read',
      [['|', ['name', 'ilike', q], ['default_code', 'ilike', q]]],
      { fields: ['id', 'name', 'default_code'], limit: 20, order: 'name asc' },
    ) as { id: number; name: string; default_code: string | false }[]
    return NextResponse.json({
      results: rows.map(r => ({ id: r.id, name: r.name, sku: r.default_code || '' })),
    })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin product-search error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}
