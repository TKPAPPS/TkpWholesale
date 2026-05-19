# Changelog

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
