import { odooAuthenticate } from './client'

// Cached server Odoo session (authenticated via API key).
// Reused across all requests — admin panel AND customer routes.
// TTL is 30 minutes (well under Odoo's default 1-week session lifetime).
let _cache: { session_id: string; expires: number } | null = null

async function acquireSession(): Promise<string> {
  const now = Date.now()
  if (_cache && now < _cache.expires) return _cache.session_id

  const { session_id } = await odooAuthenticate(
    process.env.ODOO_ADMIN_LOGIN!,
    process.env.ODOO_ADMIN_API_KEY!,
  )
  _cache = { session_id, expires: now + 30 * 60_000 }
  return session_id
}

// Call this if an Odoo call fails with a session error so the next request
// re-authenticates instead of retrying with a dead session.
function invalidate() { _cache = null }

// Customer-route names
export const getOdooSession = acquireSession
export const invalidateOdooSession = invalidate

// Admin-route names (aliases — same underlying session)
export const getAdminSession = acquireSession
export const invalidateAdminSession = invalidate
