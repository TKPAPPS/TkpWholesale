# Changelog

All notable product-level changes to the B2B Portal.

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
