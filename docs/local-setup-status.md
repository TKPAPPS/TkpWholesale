# Local Development Status

**Last updated: 2026-05-17**

This document describes what works locally right now, what is code-ready but blocked,
and what still needs Odoo field information before implementation can begin.

> **This project is NOT deployed to Vercel.**
> **Supabase is NOT connected yet.**
> **No features depending on Supabase are operational.**

---

## Environment variables required

### Currently in .env.local (working locally)
```
ODOO_URL=https://thekosherplace-tkp-staging7-31897881.dev.odoo.com
ODOO_DB=thekosherplace-tkp-staging7-31897881
SESSION_SECRET=dev-only-change-this-in-production-min-32-chars
USE_MOCK_API=false
ODOO_WEBSITE_ID=3
SKIP_PORTAL_CHECK=true        # dev only — blocks production login if set
ODOO_ADMIN_LOGIN=tal@kosher-place.com
ODOO_ADMIN_PASSWORD=kosher1234
```

### Required for Supabase features (NOT yet configured)
```
NEXT_PUBLIC_SUPABASE_URL=      # from Supabase Project Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY= # from Supabase Project Settings → API
SUPABASE_SERVICE_ROLE_KEY=     # from Supabase Project Settings → API (secret)
```

> **IMPORTANT: Never commit .env.local to git. It is already in .gitignore.**

---

## Feature status table

| Feature | Local code status | Needs Supabase? | Needs Vercel? | Needs Odoo field info? | Safe for real customers? |
|---|---|---|---|---|---|
| Customer Odoo login | **Working** (SKIP_PORTAL_CHECK bypasses portal check in dev) | No | No | No | No — SKIP_PORTAL_CHECK must be removed |
| Admin login | Code-ready, **not operational** — requires Supabase env vars | **Yes** | No | No | No |
| Admin route protection | Code-ready — middleware redirects, API returns 401 without Supabase | **Yes** | No | No | No |
| Admin settings (OOS toggle) | Code-ready, **blocked by admin auth** | **Yes** | No | No | No |
| Admin category visibility | Code-ready, **blocked by admin auth** | **Yes** | No | No | No |
| Favorites (save/view) | Code-ready, **not operational** — returns 503 SUPABASE_NOT_CONFIGURED | **Yes** | No | No | No |
| Cart hover package pricing | **Working** — shows qty × price_per_pack (excl. tax) | No | No | No | Yes |
| Cart draft quotation | **Working** | No | No | No | Partial — see visibility |
| Checkout confirmation | **Working** | No | No | No | Partial — see visibility |
| Product catalogue browse | **Working** | No | No | No | Partial — see visibility |
| Customer pricelist pricing | **Working** — pricelist applied via Odoo session | No | No | No | Yes |
| New arrivals page | **Working** — last 90 days by website publication date | No | No | No | Yes |
| Hebrew support (UI) | **Working** | No | No | No | Yes |
| Hebrew product names | **Working** — via Odoo lang context | No | No | No | Yes |
| Hebrew search | **Partial** — search uses Odoo full-text which may not rank Hebrew well | No | No | No | Partial |
| Reorder (recently ordered) | **Working** | No | No | No | Yes |
| Customer-specific product/category visibility | **Not implemented** — launch blocker | No | No | **YES — see investigation doc** | **NO** |

---

## Features that work right now (local dev)

Run `npm run dev` and log in with any Odoo portal user. These work without any external services:

- Customer login / logout via Odoo
- Product catalogue with filtering by category
- Product detail page with packaging options and pricing
- Add to cart / update / remove items
- Cart hover preview (shows package quantity × package price, not unit price)
- Cart full page with per-pack pricing
- Checkout flow (delivery address, order note, confirm)
- Order history
- Recently ordered list
- New arrivals page (last 90 days)
- Language switching (Hebrew / English)
- Category sidebar (sticky)

---

## Features that are code-ready but NOT operational (blocked by Supabase)

These features have working server-side code but will fail at runtime until Supabase is configured:

### Admin login
- Trying to log in at `/admin/login` returns: "Supabase is not configured. Add..."
- The login page shows this error clearly — no fake success, no bypass
- Once Supabase is configured and an admin user is created, this will work

### Admin pages
- Navigating to `/admin` redirects to `/admin/login` (middleware protects correctly)
- All `/api/admin/*` routes return `401 UNAUTHORIZED` when no valid admin session exists
- Even with a fake cookie, API routes verify via Supabase and return 401

### Favorites
- Trying to add/view favorites returns: `503 SUPABASE_NOT_CONFIGURED`
- The favorites page will show an error state
- Once Supabase is configured and `supabase/schema.sql` is run, this will work

---

## Steps to enable Supabase features

1. Create a Supabase project at https://supabase.com
2. Copy the URL, anon key, and service role key from: **Project Settings → API**
3. Add to `.env.local` (do NOT commit this file)
4. Open the Supabase SQL Editor and run the contents of `supabase/schema.sql`
5. Go to **Authentication → Users** and create an admin user account
6. Restart the dev server: `npm run dev`
7. Test admin login at `/admin/login`
8. Test favorites by adding a product from the catalogue

---

## Steps to test cart hover package pricing locally

1. Log in as a portal user
2. Browse to Products and add any item to the cart (choose a packaging option)
3. Hover over the cart icon in the top navigation
4. The hover preview should show: `[qty] × [price per pack] THB` per line
   Example: `2 × 960.00 THB` with a separate line total of `2,016.00 THB`
5. The unit price (per individual piece) should NOT appear in the hover
6. Open the full cart page — each item shows `[price_per_pack] / [packaging_name]`
   Example: `960.00 THB / Pack of 4`

---

## Launch blockers remaining

1. **Customer-specific product/category visibility** — Odoo field/model unknown.
   Cannot implement until Tal confirms the exact mechanism in Odoo.
   See: `docs/odoo-visibility-investigation.md`

2. **Supabase not connected** — Admin auth and favorites are non-operational.
   Requires Supabase project setup (30–60 minutes of one-time work).

3. **SKIP_PORTAL_CHECK=true** — Must be removed from `.env.local` and must NOT be
   set in production Vercel env vars. A production guard exists in code (returns 500),
   but the env var must not be present.

4. **Vercel not configured** — Not deployed. Requires adding all env vars to Vercel
   before any production deployment.

---

## What is NOT done and must NOT be claimed as complete

- Supabase favorites: not tested with two real customers
- Admin authentication: not tested with real Supabase credentials
- Admin route protection: verified in code but not verified end-to-end with real session
- Any Vercel deployment
- Customer-specific visibility
