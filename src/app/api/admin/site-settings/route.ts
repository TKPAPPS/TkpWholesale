import { NextRequest, NextResponse } from 'next/server'
import { invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'
import { readSiteSettingsUncached, writeSiteSettings } from '@/lib/odoo/odoo-helpers'
import { sanitizeSiteSettings } from '@/lib/site-settings'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  try {
    return NextResponse.json(await readSiteSettingsUncached())
  } catch (err) {
    invalidateAdminSession()
    console.error('admin site-settings GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  try {
    const body = await req.json()
    // Clamp to bounds + fill defaults so a malformed body can never store a value
    // that would break the storefront (e.g. perPage of 0). Returns what was saved.
    const settings = sanitizeSiteSettings(body)
    await writeSiteSettings(settings)
    return NextResponse.json({ ok: true, settings })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin site-settings POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE', message: 'Could not reach Odoo.' }, { status: 503 })
  }
}
