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

    // Validate shape: a map of slug -> { en: string, he: string }. Reject anything else
    // so we never stringify arbitrary/oversized junk into the Odoo config parameter.
    const isValidShape = body && typeof body === 'object' && !Array.isArray(body) &&
      Object.values(body).every((v) =>
        v && typeof v === 'object' &&
        typeof (v as { en?: unknown }).en === 'string' &&
        typeof (v as { he?: unknown }).he === 'string')
    if (!isValidShape) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: 'Body must be a map of { en, he } strings.' }, { status: 400 })
    }

    const value = JSON.stringify(body)
    if (value.length > 200_000) {  // ~200KB cap; content pages are far smaller
      return NextResponse.json({ error: 'TOO_LARGE', message: 'Content exceeds the size limit.' }, { status: 413 })
    }

    const sessionId = await getAdminSession()

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
