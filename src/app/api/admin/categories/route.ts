import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'
import { bustCategoriesCache } from '@/lib/odoo/odoo-helpers'
import { readJsonObject } from '@/lib/request-body'

const WEBSITE_ID = Number(process.env.ODOO_WEBSITE_ID ?? 3)
const PARAM_KEY = 'b2b_portal.hidden_category_ids'

async function readHiddenIds(sessionId: string): Promise<number[]> {
  const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
    [[['key', '=', PARAM_KEY]]],
    { fields: ['value'], limit: 1 },
  ) as unknown as { value: string }[]
  const raw = rows[0]?.value ?? ''
  return raw ? raw.split(',').map(Number).filter(Boolean) : []
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const sessionId = await getAdminSession()

    const [cats, heCats, hiddenIds] = await Promise.all([
      callKw(sessionId, 'product.public.category', 'search_read',
        [[['website_id', 'in', [false, WEBSITE_ID]]]],
        { fields: ['id', 'name', 'parent_id', 'sequence', 'website_id'], context: { lang: 'en_US' } },
      ) as unknown as Promise<{ id: number; name: string; parent_id: [number, string] | false; sequence: number; website_id: [number, string] | false }[]>,
      callKw(sessionId, 'product.public.category', 'search_read',
        [[['website_id', 'in', [false, WEBSITE_ID]]]],
        { fields: ['id', 'name'], context: { lang: 'he_IL' } },
      ) as unknown as Promise<{ id: number; name: string }[]>,
      readHiddenIds(sessionId),
    ])

    const heMap = new Map(heCats.map(c => [c.id, c.name]))
    const hiddenSet = new Set(hiddenIds)

    return NextResponse.json({
      categories: cats
        .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
        .map(c => ({
          id: c.id,
          name: c.name,
          name_he: heMap.get(c.id) ?? c.name,
          parent_id: c.parent_id ? c.parent_id[0] : null,
          website_id: c.website_id ? c.website_id[0] : null,
          website_name: c.website_id ? c.website_id[1] : 'Global',
          hidden: hiddenSet.has(c.id),
        })),
      hidden_ids: hiddenIds,
    })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin categories GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const body = await readJsonObject(req)
    // Validate: must be an array of positive integers (ids stringified into Odoo).
    if (!Array.isArray(body?.hidden_ids) || body.hidden_ids.some((id: unknown) => !Number.isInteger(id) || (id as number) <= 0)) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: 'hidden_ids must be an array of positive integers.' }, { status: 400 })
    }
    const hidden_ids = body.hidden_ids as number[]
    const sessionId = await getAdminSession()

    const value = hidden_ids.join(',')
    const existing = await callKw(sessionId, 'ir.config_parameter', 'search',
      [[['key', '=', PARAM_KEY]]], {},
    ) as number[]

    if (existing.length > 0) {
      await callKw(sessionId, 'ir.config_parameter', 'write', [existing, { value }], {})
    } else {
      await callKw(sessionId, 'ir.config_parameter', 'create', [{ key: PARAM_KEY, value }], {})
    }

    // Bust the shared categories cache so the storefront reflects the change immediately
    // instead of waiting up to 5 min for the Data Cache to expire.
    bustCategoriesCache()

    return NextResponse.json({ ok: true, hidden_count: hidden_ids.length })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin categories POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}
