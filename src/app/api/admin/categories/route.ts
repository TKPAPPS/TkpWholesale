import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'

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

export async function GET() {
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
  try {
    const { hidden_ids }: { hidden_ids: number[] } = await req.json()
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

    return NextResponse.json({ ok: true, hidden_count: hidden_ids.length })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin categories POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}
