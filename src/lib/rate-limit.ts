import { createServerClient } from '@/lib/supabase'

function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return !!(url && key && !url.includes('your-project') && key !== 'your-service-role-key')
}

// The `rate_limits` table has RLS on with NO policies and check_rate_limit is SECURITY
// INVOKER, so ONLY a service-role key can drive it. Anything else gets Postgres 42501 on
// every call, which this module treats as an infra blip and fails open on - meaning rate
// limiting would be entirely off while every config check still looked green. Verified
// against production on 21/08/2026 by calling the RPC with the publishable key:
//   {"code":"42501","message":"new row violates row-level security policy ..."}
// Supabase's newer sb_publishable_ / sb_secret_ key format makes this an easy mistake to
// make on a rotation, so say so loudly instead of degrading in silence.
//
// This deliberately does NOT fail closed. Locking every customer out of login because a key
// was rotated wrongly is worse than the throttle being off, and the log line is what tells
// an operator to fix it.
let keyWarningIssued = false
function warnIfNotServiceRole(key: string): void {
  if (keyWarningIssued) return
  let wrong = key.startsWith('sb_publishable_')
  if (!wrong && key.startsWith('eyJ')) {
    try {
      const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()).role
      wrong = role !== undefined && role !== 'service_role'
    } catch { /* not a readable JWT; leave it to the RPC to reject */ }
  }
  if (wrong) {
    keyWarningIssued = true
    console.error(
      'SUPABASE_SERVICE_ROLE_KEY is not a service-role key. Rate limiting is INACTIVE: ' +
      'check_rate_limit runs as the caller against an RLS-protected table and will reject ' +
      'every call. Set the service-role (sb_secret_) key.',
    )
  }
}

// Returns true if the action is ALLOWED, false if it should be rate-limited.
// Backed by the Supabase `check_rate_limit` RPC, which is atomic (INSERT ... ON CONFLICT DO
// UPDATE ... RETURNING takes a row lock) and shared across all serverless instances.
//
// It is a FIXED window, not a sliding one: `reset_at` is stamped when the window opens and
// the counter resets wholesale once it passes, so up to 2x `max` can land in a short burst
// straddling the boundary (verified 21/08/2026 - 3 calls at the end of a 60s window plus 3
// at the start of the next all succeeded). Size limits with that in mind.
//
// Fails OPEN - if Supabase is unconfigured or unreachable we allow the request, so an infra
// blip never locks users out of login. Note this covers order confirmation too, so a
// Supabase outage removes checkout throttling as well as login throttling.
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  if (!supabaseConfigured()) return true
  warnIfNotServiceRole(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')
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
