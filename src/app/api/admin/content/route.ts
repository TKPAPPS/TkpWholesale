import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'

const PARAM_KEY = 'b2b_portal.content'

type ContentMap = Record<string, { en: string; he: string }>

const DEFAULT_CONTENT: ContentMap = {
  terms: { en: '', he: '' },
  privacy: { en: '', he: '' },
  contact: { en: '', he: '' },
}

async function readContent(sessionId: string): Promise<ContentMap> {
  const rows = await callKw(sessionId, 'ir.config_parameter', 'search_read',
    [[['key', '=', PARAM_KEY]]],
    { fields: ['value'], limit: 1 },
  ) as { value: string }[]

  if (!rows[0]?.value) return { ...DEFAULT_CONTENT }
  try {
    return { ...DEFAULT_CONTENT, ...JSON.parse(rows[0].value) }
  } catch {
    return { ...DEFAULT_CONTENT }
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const sessionId = await getAdminSession()
    return NextResponse.json(await readContent(sessionId))
  } catch (err) {
    invalidateAdminSession()
    console.error('admin content GET error:', err)
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
    const sessionId = await getAdminSession()
    const value = JSON.stringify(body)

    const existing = await callKw(sessionId, 'ir.config_parameter', 'search',
      [[['key', '=', PARAM_KEY]]], {},
    ) as number[]

    if (existing.length > 0) {
      await callKw(sessionId, 'ir.config_parameter', 'write', [existing, { value }], {})
    } else {
      await callKw(sessionId, 'ir.config_parameter', 'create', [{ key: PARAM_KEY, value }], {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin content POST error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}
