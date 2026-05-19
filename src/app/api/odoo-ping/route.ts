import { NextResponse } from 'next/server'

// Temporary diagnostic endpoint — remove after debugging connection issues.
// Does NOT expose secrets — only shows sanitized config and error messages.
export async function GET() {
  const url = process.env.ODOO_URL ?? ''
  const db = process.env.ODOO_DB ?? ''
  const login = process.env.ODOO_ADMIN_LOGIN ?? ''
  const apikey = process.env.ODOO_ADMIN_API_KEY ?? ''
  const mock = process.env.USE_MOCK_API ?? '(not set)'
  const websiteId = process.env.ODOO_WEBSITE_ID ?? '(not set)'

  const config = {
    ODOO_URL: url || '(not set)',
    ODOO_DB: db || '(not set)',
    ODOO_ADMIN_LOGIN: login || '(not set)',
    ODOO_ADMIN_API_KEY: apikey ? `set (${apikey.length} chars)` : '(not set)',
    USE_MOCK_API: mock,
    ODOO_WEBSITE_ID: websiteId,
  }

  if (!url || !db || !login || !apikey) {
    return NextResponse.json({ config, auth: { status: 'skipped', reason: 'missing env vars' } })
  }

  // Test 1: HTTP reachability
  let httpStatus: number | string = 'unknown'
  try {
    const r = await fetch(`${url}/web/health`, { method: 'GET' })
    httpStatus = r.status
  } catch (e: unknown) {
    httpStatus = `fetch error: ${e instanceof Error ? e.message : String(e)}`
  }

  // Test 2: authenticate via /jsonrpc
  let authResult: { status: string; uid?: number; error?: string } = { status: 'not tested' }
  try {
    const res = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: 1,
        params: { service: 'common', method: 'authenticate', args: [db, login, apikey, {}] },
      }),
    })
    const json = (await res.json()) as { result?: number | false; error?: { message: string; data?: { message: string } } }
    if (json.error) {
      authResult = { status: 'error', error: json.error.data?.message || json.error.message }
    } else if (!json.result) {
      authResult = { status: 'invalid_credentials', error: 'uid is false — wrong DB, login, or API key' }
    } else {
      authResult = { status: 'ok', uid: json.result as number }
    }
  } catch (e: unknown) {
    authResult = { status: 'fetch_error', error: e instanceof Error ? e.message : String(e) }
  }

  return NextResponse.json({ config, http: httpStatus, auth: authResult })
}
