import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken, createServerClient } from '@/lib/supabase'

function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return !!(url && key && !url.includes('your-project') && key !== 'your-service-role-key')
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const checks: { name: string; endpoint: string; status: string; latency: string }[] = []

  // Odoo JSON-RPC ping - a cheap real call, measured.
  try {
    const sessionId = await getAdminSession()
    const start = Date.now()
    await callKw(sessionId, 'ir.config_parameter', 'search', [[['key', '=', '__ping__']]], {})
    checks.push({ name: 'Odoo JSON-RPC', endpoint: '/jsonrpc', status: 'ok', latency: `${Date.now() - start}ms` })
  } catch {
    invalidateAdminSession()
    checks.push({ name: 'Odoo JSON-RPC', endpoint: '/jsonrpc', status: 'error', latency: '-' })
  }

  // Supabase - a real lightweight count query (head: true returns no rows), measured.
  if (supabaseConfigured()) {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname
    try {
      const supabase = createServerClient()
      const start = Date.now()
      const { error } = await supabase.from('favorites').select('partner_id', { count: 'exact', head: true })
      if (error) throw error
      checks.push({ name: 'Supabase DB', endpoint: host, status: 'ok', latency: `${Date.now() - start}ms` })
    } catch {
      checks.push({ name: 'Supabase DB', endpoint: host, status: 'error', latency: '-' })
    }
  } else {
    checks.push({ name: 'Supabase DB', endpoint: 'not configured', status: 'not configured', latency: '-' })
  }

  return NextResponse.json({ checks })
}
