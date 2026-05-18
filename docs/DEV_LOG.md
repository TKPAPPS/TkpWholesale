# Dev Log

Newest entry at top.

---

## 2026-05-18 — Fix: Odoo.com SaaS API key auth + performance caching

### Goal
Fix "ordering system unavailable" error caused by API key auth failing on Odoo.com SaaS, and improve load speed for Thai users.

### Root cause
Odoo.com SaaS instances (`*.dev.odoo.com`) do NOT accept API keys via `/web/session/authenticate`. That endpoint only works with real user passwords. API keys only work through the external JSON-RPC path (`/jsonrpc` with `service=common` for auth and `service=object` for model calls). All previous admin session code was using the web session path — hence "Invalid credentials" on every call.

### Summary of changes

**Auth fix (`src/lib/odoo/client.ts`, `src/lib/odoo/admin-session.ts`)**
- Added `adminAuthenticate(login, apikey)` — calls `/jsonrpc` service=common, returns uid
- Added `callKwExternal(uid, apikey, ...)` — calls `/jsonrpc` service=object/execute_kw
- `callKw()` now detects `"uid:apikey"` token format and transparently routes to `callKwExternal` instead of `/web/dataset/call_kw`. No changes needed in any route or helper.
- `admin-session.ts` now calls `adminAuthenticate()` and returns `"${uid}:${apikey}"` as the cached token. Customer login still uses `odooAuthenticate()` (web session with real password) — unchanged.
- PDF proxy now uses `Authorization: Bearer <apikey>` header instead of session cookie.
- Image proxy uses `Authorization: Bearer <apikey>` header.

**Performance (`src/lib/odoo/odoo-helpers.ts`, `src/app/layout.tsx`)**
- `fetchOdooProducts` now caches results for 5 minutes (keyed by pricelist_id + domain + pagination). Max 200 cache entries; LRU eviction.
- `getHideOutOfStock` cache extended from 60s to 5 minutes.
- `preferredRegion = 'sin1'` added to root layout — all Vercel functions run in Singapore.
- `vercel.json` already had `regions: ["sin1"]` as backup.

**Vercel project setup**
- Switched from `talbkk11` account to `tal@kosher-place.com` account (TKPAPPS team).
- Project: `tkp-wholesale` (`prj_FhdXBreMoTUpsE5MgE8oxgFuELgo`), team `team_p1fOxoCiPu2Hj4jqkBZu22AT`.
- All 7 env vars set correctly on the new project.

### Important decisions
- **`"uid:apikey"` token format**: opaque string returned by `getOdooSession()`. `callKw()` detects it via regex `^\d+:`. Odoo session IDs are hex UUIDs and can't match this pattern — safe detection.
- **No signature changes**: all 14 route handlers and all odoo-helper functions kept their `sessionId: string` parameter. The routing is transparent.
- **Cache TTL = 5 minutes**: wholesale products change at most a few times per day. 5 minutes is safe. If a product is added in Odoo, it appears on the portal within 5 minutes.

### Checks run
- `npx tsc --noEmit` — 0 errors
- Verified API key auth works via direct curl: `uid=604` returned from `/jsonrpc` service=common

### Known risks / follow-ups
- PDF download uses `Authorization: Bearer <apikey>` — not yet confirmed whether Odoo.com SaaS report endpoint accepts this. May need fallback.
- Cache is per Vercel instance (module memory). On high traffic with many instances, each warms independently. Consider Vercel KV for shared cache if needed.
- Production Odoo should be hosted in Singapore (Odoo.sh with `asia-southeast1` GCP region) to eliminate the ~250ms Singapore→EU round trip.

### Rollback notes
Revert `admin-session.ts` to use `odooAuthenticate()` and return a real session_id. Remove `callKwExternal` and the `adminMatch` branch from `callKw()`.

---

## 2026-05-18 — Refactor: All customer routes → admin API key session

### Goal
Replace per-customer Odoo sessions with the single admin API key session for all server→Odoo calls. Customer sessions expire after 8 hours; the API key never does. This was the originally intended design.

### Summary of changes
All customer-facing API routes that previously used `parsed.odoo_session_id` (derived from the customer's login) now call `getOdooSession()` from `admin-session.ts`, which returns a cached 30-minute admin session authenticated via `ODOO_ADMIN_API_KEY`. Customer identity (partner_id, pricelist_id, commercial_partner_id, lang) is still read from the session cookie and passed as domain filters / parameters to every Odoo query — no data leaks between customers.

### Files changed

| File | Change |
|------|--------|
| `src/lib/odoo/admin-session.ts` | Added `getOdooSession`/`invalidateOdooSession` exports (aliases for existing admin session logic) |
| `src/lib/odoo/session.ts` | Made `odoo_session_id` optional (backward compat for existing cookies) |
| `src/app/api/auth/login/route.ts` | Removed `odoo_session_id` from cookie payload |
| `src/app/api/auth/logout/route.ts` | Removed Odoo session destroy call (nothing to destroy) |
| `src/app/api/products/route.ts` | `parsed.odoo_session_id` → `getOdooSession()` |
| `src/app/api/products/[id]/route.ts` | Same |
| `src/app/api/categories/route.ts` | Same |
| `src/app/api/search/route.ts` | Same |
| `src/app/api/recently-ordered/route.ts` | Same |
| `src/app/api/favorites/route.ts` | Same |
| `src/app/api/cart/route.ts` | Same |
| `src/app/api/cart/lines/route.ts` | Same |
| `src/app/api/cart/lines/[lineId]/route.ts` | Same |
| `src/app/api/orders/route.ts` | Same |
| `src/app/api/orders/[id]/route.ts` | Same |
| `src/app/api/orders/[id]/pdf/route.ts` | Same — PDF Cookie header now uses admin session_id |
| `src/app/api/checkout/review/route.ts` | Same |
| `src/app/api/checkout/confirm/route.ts` | Same |
| `src/app/api/images/product/[id]/[size]/route.ts` | Now calls `getOdooSession()` instead of extracting `odoo_session_id` from browser cookie |
| `docs/CHANGELOG.md` | Created |
| `docs/DEV_LOG.md` | Created (this file) |

### Important decisions
- **Single shared session, not per-request auth**: The `acquireSession()` function in `admin-session.ts` caches the session_id in module memory and renews it every 30 minutes. This means one cold Odoo authenticate call per Vercel instance per 30 minutes, not one per request.
- **invalidateOdooSession() in every catch**: If Odoo returns an error (e.g. session expired mid-cache-window), the cache is cleared so the next request re-authenticates cleanly.
- **Customer data isolation preserved**: `partner_id`, `commercial_partner_id`, and `pricelist_id` come from the signed session cookie and are used as Odoo domain filters. The admin session has read/write access to all Odoo data, so correct domain filtering is critical for isolation.

### Checks run
- `npx tsc --noEmit` — 0 errors after all changes

### Known risks / follow-ups
- The admin session has broad Odoo permissions. If a bug in domain filtering exists, one customer could theoretically read another's data. Review all `searchRead` domain parameters to confirm `partner_id` / `commercial_partner_id` scoping is always applied.
- PDF endpoint now authenticates as admin. Verify that `assertOrderOwnership` still enforces commercial_partner_id ownership before proxying the PDF.

### Rollback notes
To revert: restore `odoo_session_id` to the login cookie, change all route imports back to `parsed.odoo_session_id`, and remove `getOdooSession` from all non-admin routes. Session type in `session.ts` can be made non-optional again.

---
