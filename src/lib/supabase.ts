import { createClient } from '@supabase/supabase-js'

// Server-side client using the service role key — never imported in client components.
// Use this in route handlers and server-side helpers only.
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Verify a Supabase access token from the admin_session cookie.
// Returns the authenticated user email, or null if invalid.
export async function verifyAdminToken(token: string): Promise<{ email: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return null
  return { email: user.email }
}
