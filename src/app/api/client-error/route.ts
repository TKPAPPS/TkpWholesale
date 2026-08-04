import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// Fire-and-forget client-side crash telemetry. This app deliberately has no Sentry (removed
// earlier); a JS error that escapes every React error boundary and reaches global-error.tsx
// (or a route-level error.tsx) is otherwise INVISIBLE to us — it never touches the server, so
// it leaves no trace in Vercel's request logs. Both boundaries POST here so `vercel logs
// --level error` picks up a structured record instead of nothing. Public/unauthenticated on
// purpose: global-error.tsx must stay dependency-free and can fire before any session exists
// (e.g. a crash on the login page itself), so this can't require a session cookie.
export async function POST(req: NextRequest) {
  const allowed = await checkRateLimit(`client-error:${clientIp(req)}`, 20, 600)
  if (!allowed) return NextResponse.json({ ok: false }, { status: 429 })

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ ok: false }, { status: 400 })
    const { boundary, message, digest, stack, url, lang } = body as Record<string, unknown>
    // console.error so it surfaces under `vercel logs --level error`, same channel already
    // used for server-side errors (e.g. the login route's Odoo error logging).
    console.error('[client-error]', JSON.stringify({
      boundary: typeof boundary === 'string' ? boundary.slice(0, 100) : undefined,
      message: typeof message === 'string' ? message.slice(0, 1000) : undefined,
      digest: typeof digest === 'string' ? digest.slice(0, 200) : undefined,
      url: typeof url === 'string' ? url.slice(0, 500) : undefined,
      lang: typeof lang === 'string' ? lang.slice(0, 10) : undefined,
      stack: typeof stack === 'string' ? stack.slice(0, 4000) : undefined,
    }))
  } catch (err) {
    console.error('[client-error] failed to log report:', err)
  }
  // Always 200 — this is telemetry; a reporting failure must never surface to the user.
  return NextResponse.json({ ok: true })
}
