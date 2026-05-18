import { NextRequest, NextResponse } from 'next/server'
import { callKw } from '@/lib/odoo/client'
import { getAdminSession, invalidateAdminSession } from '@/lib/odoo/admin-session'
import { verifyAdminToken } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const checks: { name: string; endpoint: string; status: string; latency: string }[] = []

  // Odoo JSON-RPC ping
  let odooOk = false
  try {
    const sessionId = await getAdminSession()
    const start = Date.now()
    await callKw(sessionId, 'ir.config_parameter', 'search', [[['key', '=', '__ping__']]], {})
    checks.push({ name: 'Odoo JSON-RPC', endpoint: '/web/dataset/call_kw', status: 'ok', latency: `${Date.now() - start}ms` })
    odooOk = true
  } catch {
    invalidateAdminSession()
    checks.push({ name: 'Odoo JSON-RPC', endpoint: '/web/dataset/call_kw', status: 'error', latency: '-' })
  }

  // Odoo session auth — inferred from JSON-RPC success (same session)
  checks.push({
    name: 'Odoo Session Auth',
    endpoint: '/web/session/authenticate',
    status: odooOk ? 'ok' : 'error',
    latency: '-',
  })

  // Supabase — check env vars only (no live ping without credentials)
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const sbConfigured = !!(sbUrl && sbKey && !sbUrl.includes('your-project'))
  checks.push({
    name: 'Supabase DB',
    endpoint: sbConfigured ? new URL(sbUrl).hostname : 'not configured',
    status: sbConfigured ? 'configured' : 'not configured',
    latency: '-',
  })

  // Odoo PDF reports — untested without a real report run
  checks.push({ name: 'Odoo Report PDF', endpoint: '/report/pdf/', status: 'untested', latency: '-' })

  return NextResponse.json({ checks })
}
