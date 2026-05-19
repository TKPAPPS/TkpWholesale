import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

// Same production requirement as the customer session secret.
// Throws in production if SESSION_SECRET is missing or too short.
function getAdminSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32) {
      throw new Error('SESSION_SECRET must be set in production (min 32 chars)')
    }
    return secret
  }
  return secret ?? 'dev'
}

// HMAC token for admin sessions when Supabase is not configured.
// Throws in production if SESSION_SECRET is not properly configured.
function devAdminToken(): string {
  return createHmac('sha256', getAdminSecret()).update('admin').digest('hex')
}

// Server-side client using the service role key — never imported in client components.
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
  // Check the HMAC dev token first — works regardless of Supabase config.
  // If SESSION_SECRET is unavailable in production, devAdminToken() throws;
  // we catch it and fall through (fail closed — HMAC path unavailable).
  const adminEmail = process.env.ODOO_ADMIN_LOGIN
  if (adminEmail) {
    try {
      if (token === devAdminToken()) return { email: adminEmail }
    } catch {
      // SESSION_SECRET not configured in production — HMAC path unavailable
    }
  }

  // If Supabase is fully configured, also accept valid Supabase JWTs.
  if (isSupabaseConfigured()) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabase = createClient(url!, key!, { auth: { persistSession: false } })
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (!error && user?.email) return { email: user.email }
  }

  return null
}

// Create the dev admin session token (used by the login route)
export { devAdminToken }
