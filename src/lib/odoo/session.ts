import { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'

export interface OdooSession {
  uid: number
  partner_id: number
  commercial_partner_id: number
  odoo_session_id?: string  // no longer used for API calls; kept for backward compat
  lang: 'en' | 'he'
  pricelist_id: number | null
  name: string
  email: string
  pricelist_name: string
  iat?: number  // issued-at (unix seconds) - stamped by signSession
  exp?: number  // expiry (unix seconds) - enforced by verifySession
}

// Sessions are ROLLING, not fixed. `/api/auth/me` (polled by the customer layout
// every 5 min and on tab focus) re-issues the cookie on every successful call, so
// a customer who keeps using the portal is never logged out mid-order. Two limits
// bound it:
//
//   SESSION_IDLE_TTL_SECONDS  - how long a session survives with NO activity.
//                               Renewed on each /api/auth/me.
//   SESSION_ABSOLUTE_MAX_SECONDS - hard ceiling measured from the ORIGINAL login
//                               (`iat`), which rolling can never push past. This is
//                               what stops a browser left open on a shared counter
//                               machine from staying authenticated forever, since
//                               an open tab would otherwise renew itself indefinitely.
//
// Revocation does not depend on either: /api/auth/me re-checks the Odoo user's
// `active` flag (cached ~5 min), so deactivating a customer in Odoo still cuts
// access within minutes no matter how long their session would otherwise run.
export const SESSION_IDLE_TTL_SECONDS = 30 * 24 * 60 * 60      // 30 days
export const SESSION_ABSOLUTE_MAX_SECONDS = 60 * 24 * 60 * 60  // 60 days

// Back-compat alias: the cookie maxAge in the login route tracks the idle window.
export const SESSION_TTL_SECONDS = SESSION_IDLE_TTL_SECONDS

// In production, SESSION_SECRET must be present and at least 32 chars.
// Throws if the requirement is not met - callers that issue cookies should let
// this propagate (fail the request); callers that only verify should catch it
// and return null (treat as unauthenticated).
export function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32) {
      throw new Error('SESSION_SECRET must be set in production (min 32 chars)')
    }
    return secret
  }
  return secret ?? 'dev'
}

// Sign a session payload: base64url(JSON) + '.' + HMAC-SHA256(secret, base64url(JSON))
// base64url has no '.' characters, so splitting on the last '.' is unambiguous.
// Throws in production if SESSION_SECRET is not properly configured.
export function signSession(session: object): string {
  // Stamp iat/exp so the token carries its own lifetime; verifySession rejects
  // expired tokens regardless of the (client-controlled) cookie maxAge.
  //
  // NOTE the spread order: `...session` FIRST, then iat/exp. It used to be the
  // other way round, which meant a caller passing a payload that already carried
  // iat/exp would have those win — silently making refreshSession a no-op and
  // leaving the session pinned to its original expiry.
  const now = Math.floor(Date.now() / 1000)
  const withExp = { ...session, iat: now, exp: now + SESSION_IDLE_TTL_SECONDS }
  const payload = Buffer.from(JSON.stringify(withExp)).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

// Re-issue an already-verified session with a fresh idle window, PRESERVING the
// original `iat` so the absolute ceiling still counts from first login. Returns
// null when the absolute cap has been reached, i.e. the caller must re-authenticate.
export function refreshSession(session: OdooSession): string | null {
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = typeof session.iat === 'number' ? session.iat : now
  const absoluteDeadline = issuedAt + SESSION_ABSOLUTE_MAX_SECONDS
  if (now >= absoluteDeadline) return null

  // Never let the rolling window reach past the absolute ceiling.
  const exp = Math.min(now + SESSION_IDLE_TTL_SECONDS, absoluteDeadline)
  const payload = Buffer.from(JSON.stringify({ ...session, iat: issuedAt, exp })).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

// Seconds the refreshed cookie should live for. Mirrors the token's own exp so the
// browser drops the cookie at roughly the moment the server would reject it anyway.
export function sessionCookieMaxAge(session: OdooSession): number {
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = typeof session.iat === 'number' ? session.iat : now
  const exp = Math.min(now + SESSION_IDLE_TTL_SECONDS, issuedAt + SESSION_ABSOLUTE_MAX_SECONDS)
  return Math.max(0, exp - now)
}

function verifySession(token: string): OdooSession | null {
  // Fail closed if the secret is unavailable - treat as unauthenticated rather than crash.
  let secret: string
  try {
    secret = getSecret()
  } catch {
    return null
  }

  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const payload = token.slice(0, dot)
  const providedSig = token.slice(dot + 1)

  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  // Constant-time comparison to prevent timing attacks on the signature
  try {
    const expectedBuf = Buffer.from(expected, 'hex')
    const providedBuf = Buffer.from(providedSig, 'hex')
    if (providedBuf.length !== expectedBuf.length) return null
    if (!timingSafeEqual(providedBuf, expectedBuf)) return null
  } catch {
    return null
  }

  let parsed: OdooSession
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OdooSession
  } catch {
    return null
  }

  // Reject expired tokens. Tokens issued before this change have no exp; treat
  // them as invalid so everyone re-logs into a token that carries an expiry
  // (the cookie's own 4h maxAge means these are already near end-of-life).
  const now = Math.floor(Date.now() / 1000)
  if (typeof parsed.exp !== 'number' || parsed.exp < now) return null

  // Independently enforce the absolute ceiling. refreshSession already caps `exp`,
  // but checking `iat` here means a token minted before that cap existed (or by any
  // future code path that forgets it) still cannot outlive the ceiling.
  if (typeof parsed.iat === 'number' && now >= parsed.iat + SESSION_ABSOLUTE_MAX_SECONDS) return null

  return parsed
}

export function parseSession(req: NextRequest): OdooSession | null {
  const raw = req.cookies.get('session')?.value
  if (!raw) return null
  return verifySession(raw)
}

export function langContext(lang: 'en' | 'he'): Record<string, unknown> {
  return { lang: lang === 'he' ? 'he_IL' : 'en_US' }
}
