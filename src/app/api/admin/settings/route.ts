import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { bustHideOosCache, bustWebsiteSettingsCache } from '@/lib/odoo/odoo-helpers'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'

const PARAM_KEY = 'b2b_portal.hide_out_of_stock'

async function readParam(sessionId: string): Promise<string | false> {
  const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
    [[['key', '=', PARAM_KEY]]],
    { fields: ['key', 'value'], limit: 1 },
  ) as { key: string; value: string }[]
  return rows[0]?.value ?? false
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const sessionId = await getAdminSession()
    const value = await readParam(sessionId)
    return NextResponse.json({
      hide_out_of_stock: value === false ? true : value === 'true',
    })
  } catch (err: unknown) {
    invalidateAdminSession()
    console.error('admin settings GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const { hide_out_of_stock } = await req.json()
    const sessionId = await getAdminSession()

    const existing = await callKw(sessionId, 'ir.config_parameter', 'search',
    [[['key', '=', PARAM_KEY]]], {},
    ) as number[]

    if (existing.length > 0) {
      await callKw(sessionId, 'ir.config_parameter', 'write',
        [existing, { value: String(hide_out_of_stock) }], {},
      )
    } else {
      await callKw(sessionId, 'ir.config_parameter', 'create',
        [{ key: PARAM_KEY, value: String(hide_out_of_stock) }], {},
      )
    }

    bustHideOosCache()
    bustWebsiteSettingsCache()
    return NextResponse.json({ ok: true, hide_out_of_stock })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin settings POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}
