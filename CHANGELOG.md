# Changelog

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
