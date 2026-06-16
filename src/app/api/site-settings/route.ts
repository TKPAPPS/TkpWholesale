import { NextResponse } from 'next/server'
import { getSiteSettings } from '@/lib/odoo/odoo-helpers'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'

// Must run per-request: with no request input Next would otherwise prerender this
// route statically at build time (returning the mock defaults) and never read the
// admin's real settings at runtime. The inner getSiteSettings() still caches via the
// Data Cache, so forcing dynamic here doesn't add Odoo load on warm hits.
export const dynamic = 'force-dynamic'

const USE_MOCK = process.env.USE_MOCK_API !== 'false'

// Public storefront rules (page sizes, thresholds, etc.). Non-sensitive UI config —
// returned without auth so the customer app can hydrate without an auth race. Falls
// back to defaults whenever Odoo is unavailable or in mock mode.
export async function GET() {
  if (USE_MOCK) return NextResponse.json(DEFAULT_SITE_SETTINGS)
  try {
    return NextResponse.json(await getSiteSettings(), {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' },
    })
  } catch {
    return NextResponse.json(DEFAULT_SITE_SETTINGS)
  }
}
