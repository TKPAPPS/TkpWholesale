import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

export async function POST(req: NextRequest) {
  if (!USE_MOCK) {
    const parsed = parseSession(req)
    if (parsed?.odoo_session_id && parsed.odoo_session_id !== 'mock') {
      const { destroySession } = await import('@/lib/odoo/client')
      await destroySession(parsed.odoo_session_id)
    }
  }

  const res = NextResponse.json({})
  res.cookies.delete('session')
  return res
}
