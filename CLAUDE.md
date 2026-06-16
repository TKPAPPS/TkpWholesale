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
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (favorites, announcements, login rate limiting). Server uses the service-role key. |
| `SKIP_PORTAL_CHECK` | Dev only — skips the portal-user check on login. **Fatal 500 in production** if set to `true` (guard in the login route). |

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
| Categories | 5 min | `categories/route.ts` `_fetchCategories` (`unstable_cache`, tag `odoo-categories`); bust via `bustCategoriesCache()` |
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
stock. `buildVisibilityDomain(settingsMap, hideOos, inStockIds, hiddenIds, extra)` is shared by
the listing and the search route, so both must pass the in-stock set **and** the hidden-products
set. A `null` in-stock set (lookup failed) means "do not hide on stock" so a transient failure
shows products rather than emptying the catalog.

**Storefront rules are admin-configurable** via `b2b_portal.site_settings` (one JSON config
param): low-stock badge threshold, new-arrivals window, products/orders/invoices page sizes,
and checkout note max length. Shape + defaults + clamping live in `src/lib/site-settings.ts`
(import-safe on client and server). The admin edits them on the Settings page
(`/api/admin/site-settings`); the customer app reads them from the public `/api/site-settings`
(must stay `force-dynamic`, or Next prerenders it static and serves stale defaults) into
`siteSettingsStore`, hydrated once in `(customer)/layout.tsx`. Defaults equal the values that
were previously hardcoded, so behaviour is unchanged until an admin overrides one. The invoices
**API** reads `invoicesPerPage` server-side so its page size matches the client's pagination.

**Admin product controls** (`/admin/products`): per-product *show/hide* on the portal via
`b2b_portal.hidden_product_ids` (excluded in `buildVisibilityDomain`, keeps the product
published in Odoo) and a *publish* toggle that writes `product.website.settings.is_published`
for `WEBSITE_ID` (`setProductPublished`). **Cache coherence:** the product listing is cached
under `odoo-products` and resolves hide-OOS / published-settings / hidden-products *inside*
that cached function, so `bustHideOosCache`, `bustWebsiteSettingsCache`, and
`bustHiddenProductsCache` each also `revalidateTag('odoo-products')` — otherwise an admin
change wouldn't reach the storefront for up to 5 min.

**Featured products** (`/admin/featured`): an ordered list of template ids in
`b2b_portal.featured_template_ids` (order preserved). Admin curates via a product picker
(`/api/admin/product-search`, admin-authed — the customer `/api/search` needs a customer
session). The storefront shows a "Featured" strip at the top of `/products` (page 0, not
searching), fed by `/api/featured`, which returns the curated templates filtered to currently
visible ones, in the admin's order.

**Announcement scheduling:** the Supabase `announcements` table has `starts_at` (publish-at)
and `expires_at`. The public `/api/announcements` shows the most recent active announcement
where `starts_at` is null/past AND `expires_at` is null/future. Admin sets both on the dashboard.

**`b2b_portal.site_settings` defaults** (in `src/lib/site-settings.ts`): new-arrivals window
defaults to **30 days**, low-stock threshold 20, products/orders/invoices per page 24/20/20,
checkout note max 500 — all admin-editable on the Settings page within bounds.

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

## Customer navigation & UI
- **Top nav** (`Navbar.tsx`): desktop (`md+`) = `Categories ▾` · Products · New Arrivals ·
  Quick Order · `Orders ▾` (Orders / Recently Ordered / Invoices) · Favorites. The two
  dropdowns live in `NavMenus.tsx` (`NavCategories`, `NavOrders`, hover-intent). Right side:
  language switcher, global search overlay (icon → full-screen search), cart with hover
  preview, user name + logout. Mobile top bar keeps logo + lang + search + cart + hamburger;
  the hamburger lists the full flat set (`navLinks`) incl. Quick Order + Recently Ordered.
- **Mobile bottom tab bar** (`BottomNav.tsx`, `md:hidden`, fixed): Home · Products · Quick
  Order · Cart (live badge) · Orders. `<main>` has `pb-24 md:pb-8` so content clears it;
  respects the iOS safe-area inset.
- **Categories are global**: `categoriesStore` (zustand) is hydrated once in
  `(customer)/layout.tsx` (alongside `siteSettingsStore`) and shared by the navbar dropdown,
  the `Sidebar`, and the `MobileCategoryDrawer`.
- **`/products` category is URL-driven** (`?category=<id>`): selection is derived from the
  search param (not local state) so it links from the navbar dropdown and deep-links; the page
  is wrapped in `<Suspense>` (required for `useSearchParams`). `handleCategorySelect` does
  `router.push`, and page resets to 0 on category change. A **breadcrumb** (All Products › … ›
  current) renders above the toolbar when a category is selected.
- **`Sidebar.tsx`** powers BOTH the desktop sidebar (`hidden lg:block`) and the mobile
  `MobileCategoryDrawer` (slide-in, `lg:hidden`). Card style with a left accent bar on the
  active row; the label **selects** the category, the chevron **only expands** (distinct
  targets). RTL-aware (`border-s`, `rtl:rotate-180`).
- Customer stores live in `src/store/`: `authStore`, `langStore` (EN/HE + RTL), `cartStore`
  (optimistic), `toastStore`, `siteSettingsStore`, `categoriesStore`.

## Admin layout (responsive)
- `src/app/(admin)/layout.tsx` is the single layout for all `/admin/*` routes.
- **Nav items** (`navItems`): Dashboard · Products · Featured · Settings · Categories · Content
  · API Health. (`/admin/logs` and `/admin/audit` placeholders were removed.)
- **Desktop `md+`**: fixed `w-48` sidebar on the left; `<main>` is `flex-1 p-6 overflow-auto`.
- **Mobile `< md`**: sidebar is hidden (`hidden md:flex`). A `<header>` top bar with hamburger button appears. Hamburger opens a slide-in `w-64` drawer (same nav items + logout as desktop sidebar).
- `<main>` is now wrapped in `<div class="flex-1 flex flex-col min-w-0">` — this wrapper is required for the mobile top bar + main to stack correctly.
- `mobileOpen` state + `useEffect` locks `document.body.overflow` when drawer is open (same pattern as `MobileCategoryDrawer`).
- `/admin/login` short-circuits the layout — no sidebar or drawer is rendered on the login page.
- Admin drawer uses `start-0` (logical position) so it is RTL-aware, but admin itself does not switch language direction.

## Auth hardening
- **Login rate limiting:** both `/api/auth/login` (10/10min per IP) and `/api/admin/auth/login`
  (6/10min) call `checkRateLimit` (`src/lib/rate-limit.ts`) → the Supabase `check_rate_limit`
  RPC (atomic sliding window in the `rate_limits` table). **Fails open** if Supabase is
  unconfigured/unreachable, so logins never break on an infra blip (note: locally, with
  placeholder Supabase, rate limiting is effectively off).
- **Session revocation:** `/api/auth/me` re-checks the Odoo user's `active` flag via
  `isUidActive(uid)` (cached 5 min, fails open). The customer layout re-polls `/api/auth/me`
  every 5 min and on tab-visible, so deactivating a customer in Odoo cuts their portal access
  within minutes instead of waiting out the session TTL. (Deactivating in Odoo is the
  revocation action — no separate admin UI.) Direct-API access with a still-valid cookie
  persists until the TTL; per-route enforcement would be the next step if needed.
- **Session TTL is 4 hours** (was 8) for both customer and admin cookies.

## Admin panel auth
- Login at `/admin/login` with Odoo email + Odoo password.
- Credentials are verified via `/jsonrpc` `authenticate` (works on SaaS; `/web/session/authenticate` rejects API keys).
- Session cookie = HMAC-SHA256 of `SESSION_SECRET`. Cookie TTL: 4 hours. No `'dev'` fallback in production.
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
- Hebrew product search depends on Odoo translation data being populated for `product.template.name`. Missing translations = no Hebrew results for that product.
- **Pre-launch:** production Vercel intentionally points at the **staging** Odoo while testing.
  At launch, switch `ODOO_URL`/`ODOO_DB`/`ODOO_ADMIN_API_KEY` to production Odoo + redeploy.
- **Cost-field exposure (accepted for now):** portal users can read `standard_price` (cost) on
  products via Odoo's API. Owner accepted the risk for the ~50 known customers; the fix (a small
  Odoo.sh addon restricting the field to internal users) is deferred. Revisit before wider access.
- Session revocation only covers the app path + 4h TTL, not direct-API calls with a valid cookie
  (would need the `isUidActive` check on the ~20 data routes).
