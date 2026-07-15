# Changelog

## 2026-07-15 (Production readiness batch 2 — UX + robustness)

### Changed — UX
- `/dashboard` is now the desktop home: post-login redirect and logo link go to
  the dashboard (one-click Reorder), and "Home" leads the desktop nav.
- `/orders` list: status badge + Reorder button on every row (shared `OrderCard`
  upgrade), labeled From/To date filters, singular/plural item count.
- `/products`: search/sort/in-stock toolbar moved ABOVE the Featured strip;
  results count now localized (was hardcoded "products").
- Manual language choice persists across reloads: the Odoo profile lang applies
  only on a first-ever visit (no `lang` cookie), instead of stomping the cookie
  on every `/api/auth/me` resolve.

### Fixed — robustness
- Error boundaries added: root `global-error.tsx` + customer `error.tsx`
  (branded retry instead of Next's unstyled crash page).
- `/orders` page no longer shows an infinite spinner on network failure or a
  fake "No orders" empty state on Odoo 503 — it shows the standard
  OdooUnavailable retry state.
- Admin dashboard stats render an em-free placeholder instead of literal
  "undefined" on partial API responses.
- Image proxy fetch got a 10s abort (was the only Odoo call with no timeout).
- Order/invoice PDF routes validate the numeric id (NaN/negative -> 404),
  matching their detail routes.

## 2026-07-15 (Launch cutover + production readiness batch 1)

### Changed — launch cutover
- Production Vercel now points at PRODUCTION Odoo (`thekosherplace.odoo.com`,
  admin login `apps@kosher-place.com`). Verified live: auth OK (uid 688),
  website 3 exists, 2,324 products published, New Arrivals has 7 candidates.

### Fixed — production readiness (blockers)
- Supabase RLS enabled on `scheduled_orders` (was fully exposed to the anon
  key; `favorites`/`announcements` were already RLS-on in the live DB).
  `supabase/schema.sql` corrected — it documented `disable row level security`
  with a comment claiming the opposite effect.
- `/api/announcements` was prerendered STATIC at build time (never revalidated,
  so announcements could never appear or expire). Now `force-dynamic`, same as
  `/api/site-settings`.
- Brand logo rendered broken on every Hebrew/RTL page (SVG `<text>` re-anchored
  by inherited RTL). Fixed with CSS `direction: ltr` + explicit `textAnchor`.
- Cart line unit price was ex-VAT next to an inc-VAT line total (960 x 2 vs
  2,016 read as an overcharge). `price_per_pack` from `readCartLines` is now
  tax-inclusive (`price_total / packs`), matching product cards and the
  optimistic cart line; also drops one `product.packaging` read per cart fetch.
- Next.js 14.2.5 -> 14.2.35: fixes the critical middleware authorization
  bypass (CVE-2025-29927) among others. Remaining npm-audit highs require
  Next 15/16 (breaking) and are platform-mitigated on Vercel.

## 2026-07-08 (Review fixes + Scheduled/repeating orders)

### Added — Scheduled / repeating orders
- Customers can turn any checkout into a repeating order (daily with excluded
  weekdays, or weekly / every N weeks), with an optional end date, and manage
  them at `/scheduled-orders` (pause / resume / cancel).
- A daily Vercel cron (`/api/cron/scheduled-orders`, 23:30 UTC = 06:30 Bangkok)
  places each due order as a fully confirmed `sale.order` (so Odoo auto-creates
  manufacturing orders for MTO items, same as a manual checkout), then emails the
  customer via Resend (placed / failed). Placed regardless of live stock.
- New Supabase `scheduled_orders` table + `claim_scheduled_order` RPC. Idempotency
  is two-layered: the claim RPC stamps `last_run_date` before any Odoo call, and a
  deterministic `client_order_ref` (`AUTO:<id8>:<runDate>`) recovers a crash after
  confirm. Cron orders omit `website_id` so `findCart` never adopts them as a cart.
- New env vars: `CRON_SECRET` + `ADMIN_EMAILS` (both set in Vercel). `RESEND_API_KEY`
  / `EMAIL_FROM` are intentionally left unset for launch — portal-side email is off
  and `sendEmail` no-ops quietly; customers track schedules on `/scheduled-orders`.
  Enable Resend later for proactive placed/failed alerts.

### Fixed — code review (security)
- Admin login gated by an email allowlist (was: any valid Odoo/Supabase user).
- Admin + customer session tokens now carry iat/exp (server-enforced expiry);
  admin token compared in constant time (was a static, non-revocable HMAC).
- Checkout note HTML-stripped and capped by the admin `checkoutNoteMaxLength`;
  per-customer rate limit added to `POST /api/checkout/confirm`.

### Fixed — code review (correctness)
- Odoo client: 15s timeout on every call; `action_confirm` UserError surfaced as
  422 (not 503); `odooAuthenticate` distinguishes DB/config errors from bad creds.
- Checkout confirm read-back isolated so a transient failure returns success (no
  duplicate order); `getOrCreateCart` converges concurrent first-adds on one cart.
- Cart store: sequenced reconcile (stale response can't overwrite a newer cart);
  optimistic price no longer divides by zero; PATCH/DELETE no-op on optimistic ids.
- Cart line merge keyed on packaging + `product_uom_qty` (unit-fallback bug);
  `readCartLines` skips section/note lines and returns real HE name + SKU.
- Cart-line ownership requires `website_id`; pagination params clamped; price-sort
  category lookup no longer truncates at 100.
- Bangkok-safe dates: `formatDate` renders Odoo UTC datetimes in Asia/Bangkok;
  delivery-date bounds + `commitment_date` use Bangkok time.
- Checkout page redirects to login on 401 instead of crashing; shared order-state
  labels + `reorderLines` (list/detail agree; reorder reports failures).

## 2026-05-20 (Batch 3A — Admin nav cleanup, announcement delete confirmation)

### Changed
- **Logs and Audit removed from admin nav** — both entries removed from `navItems` in `(admin)/layout.tsx`. Desktop sidebar and mobile drawer both use this array, so both are updated by the single change. Route files at `/admin/logs` and `/admin/audit` are kept intact (accessible by direct URL).
- **Announcement delete confirmation** — clicking the delete button on an announcement now calls `window.confirm('Delete this announcement?')` before sending the DELETE request. No modal library added.

### Files changed
- `src/app/(admin)/layout.tsx` — removed `{ href: '/admin/logs', ... }` and `{ href: '/admin/audit', ... }` from `navItems`; removed `ScrollText` and `ShieldCheck` from lucide-react import
- `src/app/(admin)/admin/page.tsx` — added `if (!window.confirm('Delete this announcement?')) return` guard to `deleteAnnouncement`

### Verification performed
- `npx tsc --noEmit` — no errors
- `npm run build` — clean build, 50 pages, no warnings

### Results
- Build output confirms `/admin/logs` and `/admin/audit` routes still exist (148 B pages — their stub pages) but they are no longer linked from any nav element
- Admin login page, settings, categories, content, health, and dashboard routes unaffected

### Edge cases checked
- Both desktop sidebar and mobile drawer render from the same `navItems` array — one removal covers both
- `/admin/logs` and `/admin/audit` pages remain accessible via direct URL (not deleted)
- Announcement delete with `window.confirm` cancel path: returns early, fetch never called, UI unchanged
- `ScrollText` and `ShieldCheck` are not used anywhere else in `layout.tsx` — safe to remove from import

### Optimization notes
- No runtime impact. `navItems` is a module-level constant; smaller array = marginally less work per render (negligible).

### Documentation updated
- This CHANGELOG entry

### Known risks or follow-ups
- `/admin/logs` and `/admin/audit` are still reachable by direct URL and are protected by `src/middleware.ts` (requires valid `admin_session` cookie). No security concern.
- `window.confirm` is not keyboard-accessible in the same way a custom modal would be, but is consistent with admin-only use and avoids adding a modal dependency.
- Focus-trap for admin mobile drawer remains unimplemented (no existing project pattern).

---

## 2026-05-20 (Batch 2C — Admin responsive sidebar)

### Changed
- **Admin sidebar is now responsive** — the fixed `w-48` sidebar is hidden below the `md` (768px) breakpoint. Desktop and tablet `md+` retain the existing sidebar layout with no visual change.
- **Mobile admin top bar** — on `< md`, a sticky white header renders with a hamburger button (aria-label: "Open navigation menu") and the "Admin" title.
- **Mobile admin drawer** — tapping the hamburger slides in a `w-64 max-w-[85vw]` panel from the left. The panel contains the same nav items and logout as the desktop sidebar. The drawer closes via: close button (aria-label: "Close navigation menu"), backdrop click, or clicking any nav link.
- **Body scroll locked** while mobile drawer is open (same pattern as customer category drawer).
- **Active-link logic unchanged** — both desktop sidebar and mobile drawer use the same `exact`/`startsWith` logic.
- **Admin login page unchanged** — `if (pathname === '/admin/login') return <>{children}</>` still short-circuits layout rendering.

### Files changed
- `src/app/(admin)/layout.tsx` — added `mobileOpen` state, `useEffect` for body overflow, mobile top bar `<header>`, mobile backdrop, mobile drawer panel; `<aside>` changed from `flex` to `hidden md:flex`; `<main>` wrapped in `<div class="flex-1 flex flex-col min-w-0">` content column; `Menu` and `X` added to lucide imports

### Verification
- `npx tsc --noEmit` — no errors
- `npm run build` — clean build, 50 pages, no warnings
- `npm run lint` — ESLint not configured; skipped
- `GET /login` → HTTP 200 ✓
- `GET /api/auth/me` (no session) → `{"error":"NOT_AUTHENTICATED"}` ✓
- `GET /api/odoo-ping` → HTTP 404 ✓
- `GET /` → HTTP 307 → `/products` ✓
- `GET /admin` (no session) → HTTP 307 → `/admin/login` ✓

### Known limitations / follow-ups
- Browser/mobile testing not available. Layout verified by code review only.
- No focus-trap in the mobile drawer. Tab key can reach content behind the backdrop. No existing focus-trap pattern in the project.
- Admin area is still English-only (no RTL support). The mobile drawer uses `start-0` (logical property) for positioning, which is RTL-aware, but admin itself does not switch direction.

---

## 2026-05-20 (Batch 2A+2B — Layout, mobile, cart images)

### Fixed
- **Product card quantity selector on mobile** — added a `size="sm"` variant to `QuantitySelector` (`h-7 w-7` buttons, `w-6` input; total 80px). Product cards now use this variant so the `+` button is no longer clipped by `overflow-hidden` on 2-column mobile grids (375px+). Default size is unchanged; all other usages (cart page, etc.) are unaffected.
- **Mobile category drawer RTL animation** — in Hebrew/RTL mode the drawer panel is positioned at `start-0` (= `right: 0`). The closed state now uses `translate-x-full` in RTL (slides off-screen right) instead of `-translate-x-full` (was incorrectly sliding left). LTR English behaviour is unchanged.
- **Cart hover image fallback** — replaced the inline `onError`→`display:none` handler in the Navbar cart popover with a stable `CartLineImage` sub-component. The component holds its own `imgError` state. When `product_image_url` is empty or the image request fails (including mock mode where the proxy always returns 502), a 40×40 placeholder with a Package icon is shown instead. Layout is stable whether or not images load. Full cart page (`CartItem.tsx`) already had this pattern; now consistent everywhere.
- **Admin health page table overflow** — wrapped the health check table in `overflow-x-auto`. Added `min-w-[500px]` to the `<table>` and `whitespace-nowrap` to all cells so long Odoo endpoint URLs render on one line and the table scrolls horizontally rather than clipping.
- **Admin categories page table overflow** — same pattern: `overflow-x-auto` wrapper, `min-w-[400px]` table, `min-w-[140px]` on the Category column, `whitespace-nowrap` on Scope/Shown/Children headers. Tree indentation (`paddingLeft`) is preserved.

### Files changed
- `src/components/products/QuantitySelector.tsx` — added `size?: 'sm' | 'md'` prop; default `'md'` preserves existing behaviour
- `src/components/products/ProductCard.tsx` — pass `size="sm"` to `QuantitySelector`
- `src/components/layout/MobileCategoryDrawer.tsx` — import `useLangStore`; use `isRtl` flag to choose `translate-x-full` vs `-translate-x-full` for closed state
- `src/components/layout/Navbar.tsx` — add `CartLineImage` component; replace inline `onError` handler with `<CartLineImage src={line.product_image_url} />`
- `src/app/(admin)/admin/health/page.tsx` — `overflow-x-auto` wrapper + `min-w-[500px]` + `whitespace-nowrap`
- `src/app/(admin)/admin/categories/page.tsx` — `overflow-x-auto` wrapper + `min-w-[400px]` + column constraints

### Verification
- `npx tsc --noEmit` — no errors
- `npm run build` — clean build, 50 pages generated, no warnings
- `npm run lint` — ESLint not configured (interactive prompt); skipped
- `GET /` → HTTP 307 → `/products` ✓
- `GET /login` → HTTP 200 ✓
- `GET /api/auth/me` (no session) → `{"error":"NOT_AUTHENTICATED"}` (401) ✓
- `GET /api/odoo-ping` → HTTP 404 ✓
- `GET /api/images/product/10/128` (no session) → HTTP 401 ✓

### Known limitations / follow-ups
- Batch 2C (admin responsive sidebar / hamburger menu) is not implemented. Admin sidebar is still always visible with no mobile breakpoint. This remains an open follow-up.
- Browser testing not available. Mobile layout verified by code inspection and width calculations only.
- `product_name_he` in cart lines is not separately fetched from Odoo — Hebrew UI shows English names in cart dropdown. Out of scope for this batch; tracked in CLAUDE.md known issues.

---

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
