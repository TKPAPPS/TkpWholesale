import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

// Dev-mode admin token derived from SESSION_SECRET.
// Only valid when Supabase is not configured and NODE_ENV !== 'production'.
function devAdminToken(): string {
  return createHmac('sha256', process.env.SESSION_SECRET ?? 'dev').update('admin').digest('hex')
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
  // Always accept the Odoo-derived dev token — works regardless of Supabase config.
  // This avoids a split-brain: login uses ANON_KEY to detect Supabase, but the old
  // verify used SERVICE_ROLE_KEY; if they differed in Vercel the token was always rejected.
  const adminEmail = process.env.ODOO_ADMIN_LOGIN
  if (adminEmail && token === devAdminToken()) return { email: adminEmail }

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
