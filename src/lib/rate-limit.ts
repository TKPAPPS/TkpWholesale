import { createServerClient } from '@/lib/supabase'

function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return !!(url && key && !url.includes('your-project') && key !== 'your-service-role-key')
}

// Returns true if the action is ALLOWED, false if it should be rate-limited.
// Backed by the Supabase `check_rate_limit` RPC (atomic, shared across all
// serverless instances). Fails OPEN - if Supabase is unconfigured or unreachable
// we allow the request, so an infra blip never locks users out of login.
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  if (!supabaseConfigured()) return true
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key, p_max: max, p_window_seconds: windowSeconds,
    })
    if (error) {
      console.warn('rate limit check failed (allowing):', error.message)
      return true
    }
    return data === true
  } catch (err) {
    console.warn('rate limit check error (allowing):', err)
    return true
  }
}

// Best-effort client IP from the proxy headers Vercel sets. Falls back to a constant
// so a missing header buckets everyone together (still throttles) rather than throwing.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}
