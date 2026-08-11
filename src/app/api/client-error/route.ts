import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/rate-limit'

// Fire-and-forget client-side crash telemetry. This app deliberately has no Sentry (removed
// earlier); a JS error that escapes every React error boundary and reaches global-error.tsx
// (or a route-level error.tsx) is otherwise INVISIBLE to us - it never touches the server, so
// it leaves no trace in Vercel's request logs. Both boundaries POST here (via the shared
// reportClientError helper) so `vercel logs --level error` picks up a structured record.
// Public/unauthenticated on purpose: global-error.tsx can fire before any session exists
// (e.g. a crash on the login page itself), so this can't require a session cookie.
//
// Rate limiting is a small IN-MEMORY per-instance sliding window, NOT the Supabase-backed
// checkRateLimit. That helper fails OPEN by design - right for login (an infra blip must
// never lock customers out), wrong here (during a Supabase outage the only guard on a
// public log-write endpoint would silently vanish). Telemetry's safe failure mode is to
// DROP reports, and per-instance accuracy is plenty when the goal is just bounding log
// volume; it also costs zero I/O instead of a Supabase RPC per report.
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 20
const MAX_BUCKETS = 5000 // memory bound; a scanner sweep of spoofed IPs resets rather than grows
const buckets = new Map<string, number[]>()

function allow(ip: string): boolean {
  const cutoff = Date.now() - WINDOW_MS
  if (buckets.size >= MAX_BUCKETS && !buckets.has(ip)) buckets.clear()
  const times = (buckets.get(ip) ?? []).filter((t) => t > cutoff)
  if (times.length >= MAX_PER_WINDOW) { buckets.set(ip, times); return false }
  times.push(Date.now())
  buckets.set(ip, times)
  return true
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

// Status codes (429/413/400) are informational only - both boundary callers fire-and-forget
// and never read the response.
export async function POST(req: NextRequest) {
  if (!allow(clientIp(req))) return NextResponse.json({ ok: false }, { status: 429 })

  // The useful payload is <6KB; refuse to buffer/parse anything drastically larger.
  if (Number(req.headers.get('content-length') ?? 0) > 32_000) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false }, { status: 400 })
  const { boundary, message, digest, stack, url } = body as Record<string, unknown>

  // console.error so it surfaces under `vercel logs --level error`, the same channel already
  // used for server-side errors. `lang` comes from the request's own cookie (same-origin POST
  // carries it) rather than the client payload - one less field for the boundaries to plumb.
  console.error('[client-error]', JSON.stringify({
    boundary: str(boundary, 100),
    message: str(message, 1000),
    digest: str(digest, 200),
    url: str(url, 500),
    lang: req.cookies.get('lang')?.value.slice(0, 10),
    stack: str(stack, 4000),
  }))

  return NextResponse.json({ ok: true })
}
