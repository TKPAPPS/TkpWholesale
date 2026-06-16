import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { bustHideOosCache, bustWebsiteSettingsCache } from '@/lib/odoo/odoo-helpers'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'

const PARAM_KEY = 'b2b_portal.hide_out_of_stock'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const sessionId = await getAdminSession()
    // get_param returns the string value or false if not set; default true (hide OOS)
    const value = await callKw(sessionId, 'ir.config_parameter', 'get_param',
      [PARAM_KEY, 'true'], {},
    ) as string | false
    return NextResponse.json({
      hide_out_of_stock: value === false ? true : value !== 'false',
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
    if (typeof hide_out_of_stock !== 'boolean') {
      return NextResponse.json({ error: 'INVALID_INPUT', message: 'hide_out_of_stock must be a boolean.' }, { status: 400 })
    }
    const sessionId = await getAdminSession()

    // set_param handles create-or-update automatically
    await callKw(sessionId, 'ir.config_parameter', 'set_param',
      [PARAM_KEY, String(hide_out_of_stock)], {},
    )

    bustHideOosCache()
    bustWebsiteSettingsCache()
    return NextResponse.json({ ok: true, hide_out_of_stock })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin settings POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
