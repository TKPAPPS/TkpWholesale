# Changelog

All notable product-level changes to the B2B Portal.

---

## [Unreleased] — 2026-05-18 (continued)

### Fixed
- **Odoo.com SaaS API key auth** — API keys don't work via `/web/session/authenticate` on Odoo.com hosted instances (only real passwords do). Switched admin session to authenticate via the external `/jsonrpc` service=common endpoint, which accepts API keys correctly. All Odoo model calls now go through `/jsonrpc` service=object (`execute_kw`) instead of the web session path. No user-facing change.

### Performance
- **Product cache extended to 5 minutes** — Products, website published settings, and the hide-OOS toggle are now cached for 5 minutes per Vercel function instance (was 60 seconds). Repeat page loads within 5 minutes hit memory only — zero Odoo calls.
- **Singapore function region** — Vercel functions forced to `sin1` (Singapore) via `preferredRegion` in root layout and `vercel.json`, minimising latency for Thai users.

---

## [Unreleased] — 2026-05-18

### Changed
- **All Odoo API calls now use the admin API key** — Customer sessions are no longer used for server→Odoo communication. Every route authenticates via a single cached admin session (30-min TTL, auto-renewed). Customer identity (partner, pricelist, commercial partner) is still carried in the session cookie and passed as filter parameters to Odoo queries.
- **Session cookie simplified** — The `odoo_session_id` field is no longer written to the cookie on login. Existing cookies that still carry it will continue to work (field is optional).
- **Logout simplified** — No longer attempts to destroy an Odoo session (there is no per-customer session to destroy).
- **Product images** — Image proxy route now authenticates with the admin session instead of reading a (now-removed) `odoo_session_id` from the browser cookie.

### Fixed
- Session expiry causing Odoo 8-hour disconnects for customers who stay logged in longer than a workday.

---
