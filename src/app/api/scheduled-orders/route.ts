import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { scheduleConfigured, listSchedulesForOwner } from '@/lib/scheduled-orders-db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const parsed = parseSession(req)
  if (!parsed) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  if (!scheduleConfigured()) {
    // No backend configured — behave like an empty list rather than erroring.
    return NextResponse.json({ schedules: [] })
  }

  try {
    const schedules = await listSchedulesForOwner(parsed.commercial_partner_id)
    return NextResponse.json({ schedules })
  } catch (err) {
    console.error('scheduled-orders list error:', err)
    return NextResponse.json({ error: 'SERVER_ERROR', message: 'Could not load scheduled orders.' }, { status: 503 })
  }
}
