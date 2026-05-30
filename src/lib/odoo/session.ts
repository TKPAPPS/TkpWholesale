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
}

// In production, SESSION_SECRET must be present and at least 32 chars.
// Throws if the requirement is not met — callers that issue cookies should let
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
export function signSession(session: unknown): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function verifySession(token: string): OdooSession | null {
  // Fail closed if the secret is unavailable — treat as unauthenticated rather than crash.
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

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OdooSession
  } catch {
    return null
  }
}

export function parseSession(req: NextRequest): OdooSession | null {
  const raw = req.cookies.get('session')?.value
  if (!raw) return null
  return verifySession(raw)
}

export function langContext(lang: 'en' | 'he'): Record<string, unknown> {
  return { lang: lang === 'he' ? 'he_IL' : 'en_US' }
}
