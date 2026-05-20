# Changelog

## 2026-05-20 (Batch 1 — Navigation, routing, search, cleanup)

### Changed
- **Root `/` redirects to `/products`** — the public marketing landing page is removed. Unauthenticated users hitting `/products` are redirected to `/login` by the customer layout; after login they land on `/products`.
- **Recently Ordered removed from nav** — link removed from desktop and mobile customer navbar. The `/recently-ordered` page and `/api/recently-ordered` route remain intact.
- **Quick Order removed from dashboard** — the Quick Order CTA button removed from `/dashboard`. The `/quick-order` page and its APIs remain intact.
- **Product search clears category filter** — typing in the products page search now clears the selected category so results are not silently AND-filtered by the current category selection.
- **Search result cap raised to 50** — `/api/search` now returns up to 50 products (was 20). Both English and Hebrew are searched in parallel via Odoo; Hebrew results depend on Odoo translation data being populated.
- **Admin login error message sanitised** — the `SERVER_MISCONFIGURATION` error no longer exposes internal doc paths or env var names. Now shows: "Server configuration error. Please contact the administrator."

### Removed
- **Upstash-based login rate limiting removed** — `@upstash/redis`, `@upstash/ratelimit`, and `src/lib/rate-limit.ts` removed. Customer and admin login routes no longer depend on any external rate-limit infrastructure. Rate limiting remains a recommended future security improvement (see Known issues).
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` removed from `.env.local.example`.

### Files changed
- `src/app/(public)/page.tsx` — replaced with server-side redirect to `/products`
- `src/components/layout/Navbar.tsx` — removed Recently Ordered from `navLinks`; removed unused `Clock` import
- `src/app/(customer)/dashboard/page.tsx` — removed Quick Order button; removed unused `Zap` import
- `src/app/(customer)/products/page.tsx` — `handleSearchInput` now calls `setSelectedCategory(null)` when query is non-empty
- `src/app/api/search/route.ts` — `fetchOdooProducts` limit raised from 20 to 50
- `src/app/(admin)/admin/login/page.tsx` — sanitised `SERVER_MISCONFIGURATION` error message
- `src/app/api/auth/login/route.ts` — removed `applyRateLimit` and all rate-limit imports
- `src/app/api/admin/auth/login/route.ts` — removed `applyRateLimit` and all rate-limit imports
- `src/lib/rate-limit.ts` — deleted
- `package.json` — removed `@upstash/redis`, `@upstash/ratelimit`
- `.env.local.example` — removed Upstash env vars

### Known limitations
- Hebrew search works only if Odoo has Hebrew translations populated for `product.template.name`. If translations are absent for a product, that product will not appear in Hebrew-language search results. This is a data quality constraint in Odoo, not a code issue.
- Auth endpoint rate limiting is deferred. Recommended for a future security batch if the portal becomes more publicly accessible.

---

## 2026-05-19 (Security Fix Pack 2 — rate limiting)

### Security
- **Rate limiting on auth endpoints** — `/api/auth/login` and `/api/admin/auth/login` now enforce sliding-window rate limits via Upstash Redis (`@upstash/ratelimit`).
  - Customer login: 10 req/IP/15 min, 6 req/identifier/15 min
  - Admin login: 5 req/IP/15 min, 3 req/email/15 min
- **Production fail-closed** — if `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` are absent in production, both login endpoints return 503. No unlimited login path exists in production when rate limiting is unconfigured.
- **Dev in-memory fallback** — sliding-window emulated with a module-level `Map` when `NODE_ENV !== 'production'`. No external dependency needed for local dev.
- **Upstash errors fail open** — transient Redis errors are logged as warnings and the request is allowed through (availability > strictness for non-critical transient failures).
- **Identifiers never stored in plaintext** — Redis keys use `rl:{scope}:{field}:{SHA-256(normalized identifier)}`. Emails are trimmed+lowercased before hashing.
- **429 with `Retry-After`** — rate-limited responses include `Retry-After: <seconds>` and generic `RATE_LIMITED` error code.
- **Rate check runs before Odoo/Supabase** — no backend call is made for a rate-limited request.

### Files changed
- `src/lib/rate-limit.ts` — new helper: `checkRateLimit()`, `clientIp()`, `RateLimitConfigError`
- `src/app/api/auth/login/route.ts` — `applyRateLimit()` called before mock/real auth paths
- `src/app/api/admin/auth/login/route.ts` — `applyRateLimit()` called before Odoo/Supabase paths
- `.env.local.example` — added `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `package.json` — added `@upstash/redis`, `@upstash/ratelimit`

### Required production setup
Add via Vercel Marketplace → Upstash Redis → Storage tab. Env vars are auto-injected:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

---

## 2026-05-19 (Security Fix Pack 1 — hardening follow-up)

### Security
- **Production fail-closed for SESSION_SECRET** — `getSecret()` (customer) and `getAdminSecret()` (admin HMAC) now throw if `SESSION_SECRET` is missing or shorter than 32 chars when `NODE_ENV === 'production'`. Login no longer issues cookies signed with the `'dev'` fallback in production. `verifySession` and `verifyAdminToken` catch the throw and return null (unauthenticated), not a crash. Local dev keeps the `'dev'` fallback unchanged.

### Files changed
- `src/lib/odoo/session.ts` — `getSecret()` throws in production if SECRET missing/short; `verifySession` catches and returns null
- `src/lib/supabase.ts` — `getAdminSecret()` same production check; `devAdminToken()` uses it; `verifyAdminToken` wraps HMAC check in try/catch

---

## 2026-05-19 (Security Fix Pack 1)

### Security
- **Signed customer session cookie** — `session` cookie is now HMAC-SHA256 signed with `SESSION_SECRET`. Format: `base64url(JSON).hex(HMAC)`. Old unsigned cookies are rejected — users who had an active session must log in again. Prevents authenticated users from forging another customer's `partner_id`/`commercial_partner_id` via browser DevTools. All 15+ API routes that call `parseSession()` are protected transparently — no changes needed at call sites. Constant-time signature comparison (`crypto.timingSafeEqual`) prevents timing attacks.
- **Removed `/api/odoo-ping`** — Unauthenticated diagnostic endpoint that exposed Odoo URL, DB name, admin login, website IDs/names, and Odoo auth status. File deleted; route now returns 404.
- **Auth-gated product image proxy** — `/api/images/product/[id]/[size]` now requires a valid signed customer session; unauthenticated requests receive 401. `Cache-Control` changed from `public` to `private` so the CDN does not cache auth-gated responses.

### Files changed
- `src/lib/odoo/session.ts` — added `signSession()`, replaced `JSON.parse` with `verifySession()` (HMAC verify + decode) in `parseSession()`
- `src/app/api/auth/login/route.ts` — both mock and real cookie writes now use `signSession()` instead of `JSON.stringify()`
- `src/app/api/images/product/[id]/[size]/route.ts` — added `parseSession` auth guard; `Cache-Control: public` → `private`
- `src/app/api/odoo-ping/route.ts` — deleted

---

## 2026-05-19

### Fixed
- **Admin login loop** — `verifyAdminToken` now checks HMAC dev token first unconditionally, before any Supabase logic. Previously, if Supabase env vars were partially configured in Vercel (SERVICE_ROLE_KEY set but ANON_KEY not), login used the Odoo path but verify used the Supabase path, causing permanent UNAUTHORIZED.
- **Admin login credentials** — login now verifies via Odoo `/jsonrpc` authenticate (accepts regular passwords on SaaS). `/web/session/authenticate` was failing due to SaaS restrictions and ODOO_URL trailing slash.
- **ODOO_URL trailing slash** — stripped in `client.ts` so constructed paths never get double slashes (was causing `/web/session/authenticate` redirects from POST→GET).
- **Admin settings save** — switched from manual `search`+`write`/`create` to `set_param`/`get_param` (Odoo built-in helpers, handle create-or-update atomically).
- **Stale cart reuse** — `findCart` now filters by `website_id` and `date_order >= 7 days ago`, preventing old backend quotations from being picked up as portal carts.
- **Order date wrong** — checkout `confirm` now stamps `date_order = now` before calling `action_confirm`, so confirmed orders show today's date regardless of when the draft was created.
- **Odoo DB mismatch after instance change** — `ODOO_DB` must match the subdomain of `ODOO_URL`. Added `/api/odoo-ping` diagnostic to surface connection errors.

### Performance
- **Shared cold-start cache** — website published settings and hide-OOS setting now use Next.js `unstable_cache` (Vercel Data Cache), shared across all function instances. Previously these were module-level Maps that reset on every cold start (~1s penalty per new Vercel instance).
- **Scroll-to-top on pagination** — moved `window.scrollTo` into the `Pagination` component so it applies everywhere (products, orders, invoices).

### Admin panel
- Admin login form shows actual Odoo error on failure instead of generic message.
- Admin settings page redirects to `/admin/login` on 401 instead of silently showing stale data.

---

## Before 2026-05-19 (prior session)

### Features
- Orders page: removed status badge and progress bar (no need for status display).
- Site name changed to "The Kosher Place Wholesale" across metadata and translations.
- Favicon updated to match homepage logo SVG.

### Performance
- Layout: parallelised auth + cart fetch (removed sequential waterfall).
- Orders API: server-side pagination with `search_count` instead of fetching all then slicing.
- Category tree: O(n) build with `childMap` instead of O(n²) repeated filter.
- Add-to-cart: `validatePackaging` + `lookupPricelistPrice` + `getOrCreateCart` run in parallel; POST returns `{ ok: true }` immediately (client calls `fetchCart()` separately).
- `Cache-Control: private` headers on `/api/products` (60s) and `/api/categories` (5 min).

### Fixed
- Product page search: stale closure bug where `doSearch` read old `searchQuery` state.
- `validatePackaging`: reduced from 2 Odoo calls to 1 using domain path notation.
