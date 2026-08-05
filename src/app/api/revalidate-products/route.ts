import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

// Flush every product-availability cache NOW. The storefront caches product pages and the
// visibility sets (in-stock, published, hidden, categories) with 1-5 min TTLs; changes made
// through the ADMIN PANEL bust the right tags immediately, but changes made directly in the
// Odoo backend (unpublish, archive, sale_ok off, stock adjustments) have no such hook and
// normally wait out the TTLs. Hitting this endpoint makes them take effect immediately.
//
// Auth: Authorization: Bearer <CRON_SECRET> (same pattern as the scheduled-orders cron).
// Callable manually (curl), from an Odoo automation/webhook, or from a cron. GET and POST
// both work so it can be triggered from a browser bookmark as easily as a script.
const TAGS = [
  'odoo-products',          // cached product pages (all listing-family surfaces)
  'odoo-instock-ids',       // R4-scoped in-stock template ids
  'odoo-website-settings',  // published set + allow_out_of_stock_order flags
  'odoo-hidden-products',   // admin-hidden products
  'odoo-hidden-categories', // admin-hidden categories
  'odoo-hide-oos',          // hide-out-of-stock storefront toggle
  'odoo-categories',        // customer nav tree
  'odoo-featured',          // featured strip ids
  'odoo-best-sellers',      // best-sellers ranking
  'odoo-customer-hidden',   // per-customer hidden products/categories (res.partner fields)
]

function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  TAGS.forEach((tag) => revalidateTag(tag))
  return NextResponse.json({ ok: true, revalidated: TAGS })
}

export async function POST(req: NextRequest) { return handle(req) }
export async function GET(req: NextRequest) { return handle(req) }
