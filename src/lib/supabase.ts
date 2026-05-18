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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!isSupabaseConfigured()) {
    // Production must never reach here without Supabase configured
    if (process.env.NODE_ENV === 'production') return null
    const adminEmail = process.env.ODOO_ADMIN_LOGIN
    if (adminEmail && token === devAdminToken()) return { email: adminEmail }
    return null
  }

  const supabase = createClient(url!, key!, { auth: { persistSession: false } })
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return null
  return { email: user.email }
}

// Create the dev admin session token (used by the login route)
export { devAdminToken }
