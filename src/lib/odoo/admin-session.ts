import { adminAuthenticate } from './client'

// Cached admin credentials token in "uid:apikey" format.
// callKw() detects this format and routes to /jsonrpc (external API) instead of
// /web/session/authenticate — required for Odoo.com SaaS where API keys don't
// work with the web session endpoint.
// TTL is 30 minutes; uid is stable so re-auth just refreshes the cache entry.
let _cache: { token: string; expires: number } | null = null

async function acquireSession(): Promise<string> {
  const now = Date.now()
  if (_cache && now < _cache.expires) return _cache.token

  const apikey = process.env.ODOO_ADMIN_API_KEY!
  const uid = await adminAuthenticate(process.env.ODOO_ADMIN_LOGIN!, apikey)
  const token = `${uid}:${apikey}`
  _cache = { token, expires: now + 30 * 60_000 }
  return token
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
