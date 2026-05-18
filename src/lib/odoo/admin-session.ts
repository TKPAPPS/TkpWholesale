import { odooAuthenticate } from './client'

// Cached admin Odoo session — reused across requests within the same
// serverless instance. TTL is 30 minutes (well under Odoo's default 1-week
// session lifetime) so the cached session_id stays valid.
let _cache: { session_id: string; expires: number } | null = null

export async function getAdminSession(): Promise<string> {
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
export function invalidateAdminSession() { _cache = null }
