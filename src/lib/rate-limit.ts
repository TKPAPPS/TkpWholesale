import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { Redis } from '@upstash/redis'
import { Ratelimit, type Duration } from '@upstash/ratelimit'

export class RateLimitConfigError extends Error {
  constructor() {
    super('Rate limiting is not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing)')
    this.name = 'RateLimitConfigError'
  }
}

// Extract the best available client IP from Vercel-proxied headers.
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

// Hash identifier before use in Redis keys — raw values (email, IP) are never stored in plaintext.
function hashId(raw: string): string {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex')
}

// Dev in-memory store — only active when NODE_ENV !== 'production'.
interface DevEntry { count: number; resetAt: number }
const devStore = new Map<string, DevEntry>()

function devCheck(key: string, limit: number, windowMs: number): { limited: boolean; retryAfter: number } {
  const now = Date.now()
  const entry = devStore.get(key)
  if (!entry || now >= entry.resetAt) {
    devStore.set(key, { count: 1, resetAt: now + windowMs })
    return { limited: false, retryAfter: 0 }
  }
  entry.count++
  if (entry.count > limit) {
    return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { limited: false, retryAfter: 0 }
}

// Check a single rate-limit dimension (e.g. IP or hashed email).
// Key format: rl:{scope}:{field}:{SHA-256(normalized identifier)}
//
// Throws RateLimitConfigError in production when Upstash vars are absent — caller must return 503.
// On any other Upstash error, fails open: warns and returns { limited: false }.
export async function checkRateLimit(
  scope: string,
  field: string,
  identifier: string,
  limit: number,
  window: Duration,
  windowMs: number,
): Promise<{ limited: boolean; retryAfter: number }> {
  const key = `rl:${scope}:${field}:${hashId(identifier)}`

  if (process.env.NODE_ENV !== 'production') {
    return devCheck(key, limit, windowMs)
  }

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    // Upstash not configured — skip rate limiting rather than blocking login
    return { limited: false, retryAfter: 0 }
  }

  try {
    const redis = new Redis({ url, token })
    const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: '' })
    const { success, reset } = await rl.limit(key)
    if (!success) {
      return { limited: true, retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) }
    }
    return { limited: false, retryAfter: 0 }
  } catch (err) {
    if (err instanceof RateLimitConfigError) throw err
    console.warn('[rate-limit] Upstash error — failing open:', (err as Error).message ?? err)
    return { limited: false, retryAfter: 0 }
  }
}
