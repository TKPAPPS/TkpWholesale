import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'
import { getSecret } from '@/lib/odoo/session'

const ADMIN_TOKEN_TTL_SECONDS = 4 * 60 * 60

// Signed admin session token: base64url(JSON{sub,iat,exp}) + '.' + HMAC.
// Unlike the old static HMAC('admin'), this carries a per-issue expiry and a
// subject, is compared in constant time, and expires without a SESSION_SECRET
// rotation. `email` identifies which admin the token was issued to.
export function signAdminToken(email: string): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub: email, iat: now, exp: now + ADMIN_TOKEN_TTL_SECONDS })).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

// Verify a signed admin token. Returns the subject email or null.
function verifySignedAdminToken(token: string): { email: string } | null {
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
  try {
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(providedSig, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; exp?: number }
    const now = Math.floor(Date.now() / 1000)
    if (!parsed.sub || typeof parsed.exp !== 'number' || parsed.exp < now) return null
    return { email: parsed.sub }
  } catch {
    return null
  }
}

// Allowlist of emails permitted to hold an admin session. ADMIN_EMAILS is a
// comma-separated list; if unset, fall back to the single configured admin login.
// Used to gate BOTH login paths so a valid Odoo/Supabase credential alone is not
// sufficient for admin access.
export function isAdminEmail(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS || process.env.ODOO_ADMIN_LOGIN || ''
  const allow = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (allow.length === 0) return false
  return allow.includes(email.trim().toLowerCase())
}

// Server-side client using the service role key - never imported in client components.
// Use this in route handlers and server-side helpers only.
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Verify a Supabase access token from the admin_session cookie.
// Returns the authenticated user email, or null if invalid / unauthorized.
// In dev without Supabase: accepts the deterministic dev token set by the login route.
function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return !!(url && key && !url.includes('your-project') && key !== 'your-service-role-key')
}

export async function verifyAdminToken(token: string): Promise<{ email: string } | null> {
  // Signed HMAC admin token (issued by the Odoo login path). Carries its own
  // expiry and is compared in constant time.
  const signed = verifySignedAdminToken(token)
  if (signed && isAdminEmail(signed.email)) return signed

  // If Supabase is fully configured, also accept valid Supabase JWTs - but still
  // require the email to be on the admin allowlist.
  if (isSupabaseConfigured()) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabase = createClient(url!, key!, { auth: { persistSession: false } })
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (!error && user?.email && isAdminEmail(user.email)) return { email: user.email }
  }

  return null
}
