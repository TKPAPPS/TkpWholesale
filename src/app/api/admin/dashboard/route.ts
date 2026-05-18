import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const sessionId = await getAdminSession()
    const today = new Date().toISOString().slice(0, 10)

    const [ordersToday, openCarts] = await Promise.all([
      callKw(sessionId, 'sale.order', 'search_count',
        [[['date_order', '>=', `${today} 00:00:00`], ['state', 'in', ['sale', 'done']]]],
        {},
      ) as Promise<number>,
      callKw(sessionId, 'sale.order', 'search_count',
        [[['state', '=', 'draft']]],
        {},
      ) as Promise<number>,
    ])

    return NextResponse.json({ orders_today: ordersToday, open_carts: openCarts })
  } catch (err) {
    invalidateAdminSession()
    console.error('admin dashboard GET error:', err)
    return NextResponse.json({ error: 'ODOO_UNAVAILABLE' }, { status: 503 })
  }
}
