# B2B Portal — Claude Context

## What this is
Next.js 14 App Router B2B ordering portal for TKP Wholesale (kosher food distributor, Thailand).
Customers log in and place orders. All product/pricing/order data lives in Odoo 18.

## Key architecture rules
- **Browser never calls Odoo directly.** All Odoo access goes through Next.js API routes (BFF pattern).
- **Admin API key for all server→Odoo calls.** `getOdooSession()` returns a `"uid:apikey"` token. `callKw()` detects this format and routes to `/jsonrpc` (Odoo external API). Do NOT use `odooAuthenticate()` for server-side Odoo calls — it uses the web session path which rejects API keys on Odoo.com SaaS.
- **Customer identity from session cookie only.** `partner_id`, `pricelist_id`, `commercial_partner_id`, `lang` come from the signed `session` cookie. They are used as Odoo domain filters — never trust them for writes without ownership checks.
- **No secrets in browser.** `ODOO_ADMIN_API_KEY`, `SESSION_SECRET`, etc. are server-only env vars.

## Odoo auth — critical
Odoo.com SaaS instances (`*.dev.odoo.com`) reject API keys on `/web/session/authenticate`.
API keys ONLY work via `/jsonrpc` service=common (auth) and service=object (model calls).
See `src/lib/odoo/client.ts` → `adminAuthenticate()` and `callKwExternal()`.
The `"uid:apikey"` token format is how `admin-session.ts` signals to `callKw()` which path to use.

## Env vars (never commit)
| Var | Purpose |
|-----|---------|
| `ODOO_URL` | Odoo instance base URL |
| `ODOO_DB` | Odoo database name |
| `ODOO_ADMIN_LOGIN` | Admin user email (currently `tal@kosher-place.com`) |
| `ODOO_ADMIN_API_KEY` | Odoo API key for server-side calls |
| `SESSION_SECRET` | Signs the customer session cookie (min 32 chars) |
| `USE_MOCK_API` | Set to `false` for real Odoo; anything else uses mock data |
| `ODOO_WEBSITE_ID` | Odoo website ID (currently `3`) |

## Deployment
- **Vercel account**: `tal@kosher-place.com` (TKPAPPS team)
- **Project**: `tkp-wholesale` — `prj_FhdXBreMoTUpsE5MgE8oxgFuELgo`
- **Team**: `team_p1fOxoCiPu2Hj4jqkBZu22AT`
- **Token**: stored in user memory (ask user)
- **GitHub**: `TKPAPPS/TkpWholesale` — push with the PAT stored in user memory
- **Region**: `sin1` (Singapore) — set in `vercel.json` and `src/app/layout.tsx`
- Deploy: `npx vercel --prod --token <token>`

## Caching
| Cache | TTL | Location |
|-------|-----|----------|
| Admin session token | 30 min | `admin-session.ts` (module memory) |
| Products (per pricelist+domain+pagination+lang) | 5 min | `odoo-helpers.ts` `_fetchProductsCached` (`unstable_cache` — shared across Vercel instances, survives cold starts) |
| Website published settings | 5 min | `odoo-helpers.ts` `_fetchWebsiteSettings` (`unstable_cache` — shared across Vercel instances) |
| In-stock template ids | 2 min | `odoo-helpers.ts` `_fetchInStockIds` (`unstable_cache` — shared) — avoids per-request `qty_available` compute |
| Storefront rules (site_settings) | 5 min | `odoo-helpers.ts` `_fetchSiteSettings` (`unstable_cache` — shared); bust via `bustSiteSettingsCache()` on admin save |
| Featured template ids | 5 min | `odoo-helpers.ts` `_fetchFeaturedIds` (`unstable_cache`); bust via `bustFeaturedCache()` |
| Hidden product ids | 5 min | `odoo-helpers.ts` `_fetchHiddenProductIds` (`unstable_cache`); bust via `bustHiddenProductsCache()` |
| Hide-OOS setting | 1 min | `odoo-helpers.ts` `_fetchHideOos` (`unstable_cache` — shared across Vercel instances) |
| Categories | 5 min | `categories/route.ts` `_cache` (module memory) |
| Product images | 1 day browser + Vercel edge (`s-maxage`, `stale-while-revalidate` 7 days) | `images/product/[id]/[size]/route.ts` `Cache-Control: public` |

Call `bustProductCache()` / `bustWebsiteSettingsCache()` to invalidate after Odoo data changes.
All three (`bustProductCache`, `bustWebsiteSettingsCache`, `bustHideOosCache`) call
`revalidateTag` to clear the shared Next.js Data Cache. `bustProductCache()` clears
the `odoo-products` tag.

**Stock visibility is resolved against a cached id set, never an inline `qty_available`
filter.** `qty_available` is a non-stored computed field, so a `['qty_available','>',0]`
term forces Odoo to compute live stock for the whole catalog (~600ms per cold request).
`buildVisibilityDomain` instead takes the cached in-stock id set (`getInStockIds`) and
emits a plain `['id','in',[...]]` domain (~60ms). The visible set is identical to the old
filter (verified); stock display is up to ~2 min stale and checkout still validates real
stock. `buildVisibilityDomain` is shared by the listing and the search route, so both must
pass the in-stock set. A `null` set (lookup failed) means "do not hide on stock" so a
transient failure shows products rather than emptying the catalog.

**Storefront rules are admin-configurable** via `b2b_portal.site_settings` (one JSON config
param): low-stock badge threshold, new-arrivals window, products/orders/invoices page sizes,
and checkout note max length. Shape + defaults + clamping live in `src/lib/site-settings.ts`
(import-safe on client and server). The admin edits them on the Settings page
(`/api/admin/site-settings`); the customer app reads them from the public `/api/site-settings`
(must stay `force-dynamic`, or Next prerenders it static and serves stale defaults) into
`siteSettingsStore`, hydrated once in `(customer)/layout.tsx`. Defaults equal the values that
were previously hardcoded, so behaviour is unchanged until an admin overrides one. The invoices
**API** reads `invoicesPerPage` server-side so its page size matches the client's pagination.

The product list is read in a **single language** (`lang` query param → `'en'` | `'he'`).
The `/products` and `/new-arrivals` pages refetch on language switch, so reading both
EN + HE was wasted Odoo work; `fetchOdooProducts` defaults to `lang='both'` only for
callers (favorites, recently-ordered, product detail) that still need EN as canonical
alongside HE.

The image proxy is **not session-gated** — the same images are already public on Odoo's
own `/web/image` endpoint and are served CDN-public via `Cache-Control: public`, so the
gate added no real protection, and removing it lets the Vercel image optimizer fetch the
route server-side (it has no session cookie). `<Image>` is now optimized (AVIF/WebP,
resized) everywhere — `unoptimized` was removed from the product grid, detail page, cart,
quick-order, and navbar mini-cart. Product-grid cards request `image_256`; the product
detail page uses `image_512`; thumbnails use `image_128`. Note: a `public` edge cache
serves cached images to unauthenticated requests — acceptable for product photos, not for
anything sensitive.

## Mock mode
`USE_MOCK_API !== 'false'` → all routes return mock data from `src/lib/odoo/mock/data.ts`.
Mock data is never complete — do not treat mock behaviour as ground truth for real Odoo.

## Cart behaviour (optimistic)
- **Add to cart is optimistic.** `ProductCard` and the product detail page call
  `addLineOptimistic(product, pkg, qty)` on the `cartStore` to update the local
  cart instantly (merge-or-append + total recompute), then fire
  `POST /api/cart/lines` in the background. They do NOT await it for UI feedback.
- **Reconcile / rollback:** on a 2xx the handler calls `setCart(responseCart)` to
  replace the optimistic state with Odoo's real cart; on failure it calls
  `fetchCart()` to resync (undoing the optimistic line) and shows an error toast.
- **`POST /api/cart/lines` returns the full cart** (via `readCart`), not
  `{ ok: true }` — so the client reconciles in one round-trip with no separate
  `GET /api/cart`. Other callers (dashboard, order reorder, quick-order) ignore
  the body and call `fetchCart()` themselves, so the richer response is backward
  compatible. Caveat: because `readCart` now runs inside the POST, a read failure
  after a successful line write surfaces to the client as a generic failure.
- Optimistic prices use the card's tax-inclusive pack price, not the customer's
  pricelist `price_unit`; they are approximate until the server reconciles.
- `lookupPricelistPrice` fetches the pricelist items and the template `list_price`
  in parallel (the `list_price` read is now unconditional, even for fixed-price
  customers) to save a serial Odoo hop on the percentage/formula path.

## Admin layout (responsive)
- `src/app/(admin)/layout.tsx` is the single layout for all `/admin/*` routes.
- **Desktop `md+`**: fixed `w-48` sidebar on the left; `<main>` is `flex-1 p-6 overflow-auto`.
- **Mobile `< md`**: sidebar is hidden (`hidden md:flex`). A `<header>` top bar with hamburger button appears. Hamburger opens a slide-in `w-64` drawer (same nav items + logout as desktop sidebar).
- `<main>` is now wrapped in `<div class="flex-1 flex flex-col min-w-0">` — this wrapper is required for the mobile top bar + main to stack correctly.
- `mobileOpen` state + `useEffect` locks `document.body.overflow` when drawer is open (same pattern as `MobileCategoryDrawer`).
- `/admin/login` short-circuits the layout — no sidebar or drawer is rendered on the login page.
- Admin drawer uses `start-0` (logical position) so it is RTL-aware, but admin itself does not switch language direction.

## Admin panel auth
- Login at `/admin/login` with Odoo email + Odoo password.
- Credentials are verified via `/jsonrpc` `authenticate` (works on SaaS; `/web/session/authenticate` rejects API keys).
- Session cookie = HMAC-SHA256 of `SESSION_SECRET`. Cookie TTL: 8 hours. No `'dev'` fallback in production.
- `verifyAdminToken` always checks the HMAC token first, then Supabase JWT if Supabase is configured.
- If Supabase env vars are partially set in Vercel (e.g. SERVICE_ROLE_KEY set but ANON_KEY not), the HMAC path still works.

## Customer session cookie
- Cookie name: `session`. Format since 2026-05-19: `base64url(JSON).hex(HMAC-SHA256(SESSION_SECRET, base64url(JSON)))`.
- **`SESSION_SECRET` is required in production (min 32 chars).** In `NODE_ENV=production`, both `getSecret()` (customer) and `getAdminSecret()` (admin) throw if it is missing or shorter than 32 chars. There is NO production fallback — misconfigured deploys fail closed. Local dev falls back to `'dev'`.
- `parseSession(req)` in `src/lib/odoo/session.ts` verifies the HMAC before returning the payload. Returns `null` for missing, unsigned, tampered, malformed cookies, or if SECRET is unavailable — callers treat this as unauthenticated.
- `signSession(payload)` in `src/lib/odoo/session.ts` is the only place that should write a customer session cookie value. Only called from `src/app/api/auth/login/route.ts`. Throws if SESSION_SECRET is unavailable in production — the login route's try/catch converts this to a 503 response.
- Old unsigned (plain JSON) cookies are rejected — users must re-login after this change.

## Known issues / follow-ups
- PDF download: `ir.attachment` strategy implemented but not confirmed working end-to-end on SaaS.
- Product list cache is now shared across instances via `unstable_cache` (Data Cache). No explicit pre-warm — the first request per key warms it; add a cron hitting common categories if cold-start latency on rarely-hit keys matters.
- Production Odoo should be in Singapore (Odoo.sh `asia-southeast1`) to cut ~250ms EU round trip.
- `findCart` only picks up portal carts ≤7 days old (prevents stale quotation reuse).
- Auth endpoint rate limiting is deferred — recommended for a future security batch if the portal becomes more publicly accessible.
- Hebrew product search depends on Odoo translation data being populated for `product.template.name`. Missing translations = no Hebrew results for that product.
- `/recently-ordered` and `/quick-order` pages are accessible by URL but are not linked from any navigation.
- Customer top-nav (`Navbar.tsx` `navLinks`, shared by desktop + mobile): Products, New Arrivals, Favorites, Orders, Invoices. New Arrivals is a top-level menu item linking to `/new-arrivals` (it used to render as a strip at the top of `/products`; that strip was removed). Active state is `pathname.startsWith(href)`.
