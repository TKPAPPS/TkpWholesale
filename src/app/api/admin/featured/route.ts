import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'
import { readFeaturedIdsUncached, writeFeaturedIds } from '@/lib/odoo/odoo-helpers'
import { readJsonObject } from '@/lib/request-body'

async function gate(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  return !!token && !!(await verifyAdminToken(token))
}

// Returns the ordered featured templates with names/SKUs for the admin list.
export async function GET(req: NextRequest) {
  if (!(await gate(req))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  try {
    const ids = await readFeaturedIdsUncached()
    if (ids.length === 0) return NextResponse.json({ featured: [] })
    const sessionId = await getAdminSession()
    const rows = await callKw(sessionId, 'product.template', 'read', [ids],
      { fields: ['id', 'name', 'default_code'] },
    ) as { id: number; name: string; default_code: string | false }[]
    const byId = new Map(rows.map(r => [r.id, r]))
    // Preserve the admin's order; silently drop ids whose product no longer exists.
    const featured = ids
      .map(id => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(r => ({ id: r.id, name: r.name, sku: r.default_code || '' }))
    return NextResponse.json({ featured })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin featured GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await gate(req))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  try {
    const body = await readJsonObject(req)
    if (!Array.isArray(body?.ids) || body.ids.some((id: unknown) => !Number.isInteger(id) || (id as number) <= 0)) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: 'ids must be an array of positive integers.' }, { status: 400 })
    }
    // Dedupe while preserving order.
    const ids = Array.from(new Set(body.ids as number[]))
    await writeFeaturedIds(ids)
    return NextResponse.json({ ok: true, count: ids.length })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin featured POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
