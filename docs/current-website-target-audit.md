# B2B Portal — Target Specification Audit

**Date:** 2026-05-15  
**Auditor:** Claude (AI audit — code-only, no live browser testing)  
**Branch audited:** `main`  
**Odoo environment:** Staging (`thekosherplace-tkp-staging7-31897881.dev.odoo.com`)  
**USE_MOCK_API:** `false` (live Odoo mode confirmed via `.env.local`)

---

## 1. Executive Summary

**Overall readiness score: 52 / 100**

The portal has a complete and well-architected UI, a correct Odoo BFF pattern, a real Odoo cart implementation, and a solid type system. For a staging/demo build this is impressive. However, significant gaps separate it from being safe for real customer use. The most dangerous gap is the **admin area has zero authentication protection** — any anonymous visitor can navigate to `/admin` and change website settings that write to Odoo's `ir.config_parameter`. Equally serious: **favorites are stored in a shared in-memory `Set` on the server**, meaning all customers share the same favorites and they reset on every deploy. Customer-specific product pricing (pricelist) is displayed incorrectly on product browse pages. Reorder is a UI button that does nothing. Hebrew names are missing from cart lines and order lines. No rate limiting exists on any endpoint.

### Biggest 5 Gaps

1. **Admin area is entirely unprotected.** No Supabase auth. Any unauthenticated visitor can access `/admin/settings` and toggle settings that modify Odoo. The login form accepts any credentials and redirects unconditionally.
2. **Favorites are broken and a security bug.** All customers share one server-side in-memory `Set`. Favorites are lost on every Vercel redeploy. No Supabase integration exists.
3. **Customer pricelist not applied to product browse prices.** Prices on the product listing/detail page are computed from `list_price` (global), not the customer's assigned pricelist. Customers may see wrong prices before adding to cart.
4. **Reorder is not implemented.** The "Reorder" button exists in the order detail UI (`orders/[orderId]/page.tsx`) but has no `onClick` handler and does nothing.
5. **No rate limiting on any endpoint.** Login, search, checkout, and PDF download are all unprotected from brute-force or abuse.

### Biggest 5 Risks

1. **Admin settings can be changed by anyone.** The admin layout skips auth when pathname is not `/admin/login` but does not enforce that the user has logged in. An attacker can visit `/admin/settings` and hide all products.
2. **`SKIP_PORTAL_CHECK=true` in `.env.local`.** If this variable reaches a production deploy, internal Odoo users (non-portal) can log in as customers.
3. **Clear cart does not cancel the Odoo quotation.** It only removes all lines via ORM command 5. The `sale.order` record stays in Odoo in `draft` state with no lines, creating an abandoned quotation accumulation problem.
4. **Per-customer visibility is not implemented.** There is no mechanism to restrict specific products or categories per customer. All authenticated customers see the same published catalog. If Odoo has customer-specific product access rules, they are not enforced.
5. **Hebrew names missing from live data in cart and order history.** `product_name_he` in cart lines and order history lines always returns the English name. For Hebrew-language customers this means the cart and orders show English names only.

---

## 2. Feature Compliance Matrix

| Area | Target | Status | Evidence | Severity | Recommendation |
|------|--------|--------|----------|----------|----------------|
| **A. Auth — Login flow** | Odoo portal users only | **Complete** | `api/auth/login/route.ts`: `odooAuthenticate` + `verifyPortalUser(share=true)` | — | — |
| **A. Auth — No public registration** | None | **Complete** | No `/register` route exists | — | — |
| **A. Auth — Products behind login** | Hidden pre-login | **Complete** | All `/api/*` routes return 401 without session cookie | — | — |
| **A. Auth — Session security** | Server-side only | **Complete** | `iron-session` HTTP-only encrypted cookie, 8h TTL | — | — |
| **A. Auth — SKIP_PORTAL_CHECK** | Must be removed | **Launch-blocker** | `.env.local` has `SKIP_PORTAL_CHECK=true`. If deployed, internal users bypass portal check | Launch-blocker | Remove before production deploy |
| **A. Auth — Admin auth separate** | Supabase, not Odoo | **Missing** | `admin/login/page.tsx` calls `setTimeout` then redirects unconditionally. Any credentials work. | Launch-blocker | Implement Supabase admin auth |
| **B. Products — Source** | Odoo only | **Complete** | `fetchOdooProducts` via `product.template` search_read | — | — |
| **B. Products — Images** | Odoo only | **Complete** | `api/images/product/[id]/[size]` proxies `/web/image/product.template/…` with session | — | — |
| **B. Products — Hebrew names** | Odoo (he_IL context) | **Complete** | Parallel EN + HE fetch in `fetchOdooProducts`; categories also dual-language | — | — |
| **B. Products — Per-customer visibility** | Top priority | **Missing** | `fetchOdooProducts` filters by website publication (`product.website.settings`) but applies the same filter for all customers. No per-customer product/category restriction mechanism exists. | High | Implement customer-specific visibility using Odoo partner-level product access or pricelist-based filtering |
| **B. Products — Direct URL protection** | Hidden products → 404 | **Complete** | `api/products/[id]` calls `fetchOdooProducts([['id','=',id]])` which filters through `websiteSettingsMap`; non-published product returns 404 | — | — |
| **B. Products — Empty categories hidden** | Yes | **Missing** | `fetchOdooCategories` returns all non-hidden categories regardless of whether any published+in-stock products exist in them | Medium | Filter out categories with zero visible products |
| **B. Products — Stock/sellability rules** | Live from Odoo | **Partial** | `hide_out_of_stock` admin toggle + `allow_out_of_stock_order` per website setting implemented. But `qty_available` for consumable products (`type='consu'`) behaves unexpectedly — consumables with zero tracked qty may be hidden even if they're conceptually always available | High | Treat `type='consu'` products as always in-stock for OOS filter |
| **B. Products — Old orders show historical** | Yes, without reorder | **Partial** | Order history shows products correctly. Reorder button is present but non-functional (see J) | Medium | — |
| **C. Browsing — Products page** | Post-login landing | **Complete** | `(customer)/products/page.tsx` is the main page; layout redirects unauthenticated users to login | — | — |
| **C. Browsing — Category sidebar** | Sidebar + tree | **Complete** | `Sidebar.tsx` with expand/collapse, sticky positioning | — | — |
| **C. Browsing — Pagination** | Traditional | **Complete** | Windowed pagination with prev/next and ellipsis | — | — |
| **C. Browsing — Sort options** | Name, price, recently ordered | **Complete** | Dropdown with 3 options; Odoo `order` param used | — | — |
| **C. Browsing — No filters** | Deferred | **Complete** | No filters present | — | — |
| **C. Browsing — Mobile layout** | Fully mobile-friendly | **Partial** | Sidebar hidden on mobile (`hidden lg:block`), no mobile category navigation provided. Mobile users cannot filter by category. | High | Add mobile category sheet/drawer |
| **D. Search — Exists** | Yes | **Complete** | `api/search/route.ts` + search bar in products page | — | — |
| **D. Search — English name** | Yes | **Complete** | `['name', 'ilike', q]` in domain | — | — |
| **D. Search — SKU** | Yes | **Complete** | `['default_code', 'ilike', q]` in domain | — | — |
| **D. Search — Hebrew name** | Yes | **Missing** | Search sends query to Odoo in session language context. If session lang is `en_US`, searching Hebrew text against `name` field returns nothing because the EN field doesn't contain Hebrew. There is no separate Hebrew-context search call. | High | Run two parallel searches: one in `en_US` and one in `he_IL` context; merge and deduplicate results |
| **D. Search — Visibility respected** | Yes | **Complete** | Real-mode search routes through `fetchOdooProducts` which applies website publication filter | — | — |
| **E. Language — Switching** | EN/HE toggle | **Complete** | `LanguageSwitcher` component; `langStore` sets `document.dir` and cookie | — | — |
| **E. Language — Full RTL** | Yes | **Partial** | `document.dir=rtl` and `html dir=rtl` set correctly. Tailwind logical properties used (`ps-`, `pe-`, `ms-`, `me-`). Some components use `text-end` (correct) but a few use `text-right` and `justify-end` which may not mirror. Logo RTL bug fixed (audited during same session). | Medium | Audit all components for `left`/`right` vs logical properties |
| **E. Language — Preference saved** | Supabase | **Partial** | Language saved in browser cookie only (`setLangCookie`). No Supabase write. Not persistent across devices or browsers. | Medium | Write lang preference to Supabase on change |
| **F. Packaging — UI correct** | Pack quantity, not units | **Complete** | `PackagingOption` model; `product_packaging_qty` used in all cart operations | — | — |
| **F. Packaging — Multiple options** | Selector if >1 | **Partial** | `products/[id]/page.tsx` shows a packaging selector. The products list card (ProductCard) may auto-select the first packaging without exposing the selector — this could mean customers on the listing page can only use one packaging | Medium | Verify ProductCard handles multi-packaging products on listing |
| **F. Packaging — Package + unit price** | Both shown | **Complete** | `price_per_pack_incl_tax`, `price_per_unit_incl_tax` both in data model and shown in product detail | — | — |
| **F. Packaging — Pricing from Odoo** | Yes | **Partial** | Prices on product browse/detail pages are computed from `list_price` via frontend tax calculation in `odoo-helpers.ts`. Customer-specific pricelist is stored in session (`pricelist_id`) but **never used in product price display**. Cart/order prices do use pricelist (Odoo computes them). Customers may see a different price on browse vs cart. | High | Pass `pricelist_id` in Odoo context when fetching product prices, or use Odoo's `product.pricelist._get_product_price` |
| **F. Currency hardcoded** | Should come from Odoo | **Missing** | `currency: 'THB'` hardcoded in `fetchOdooProducts` (`odoo-helpers.ts` line ~316) and in `emptyCart()`. Cart totals correctly read currency from `currency_id` field but product prices always show THB. | Medium | Read currency from partner pricelist or company settings |
| **G. Cart — Odoo draft quotation** | Yes | **Complete** | `findCart`/`getOrCreateCart`/`readCart` all operate on `sale.order` in `draft` state | — | — |
| **G. Cart — Real-time Odoo updates** | Yes | **Complete** | Every add/update/delete hits Odoo and returns updated cart | — | — |
| **G. Cart — Debounce** | Yes | **Missing** | No debounce in `CartItem.tsx` quantity updates. Each increment/decrement fires an immediate API call. | Medium | Add 400–600ms debounce on quantity change |
| **G. Cart — One cart per customer** | Yes | **Partial** | `findCart` finds latest draft by `partner_id`. However, if customer has multiple draft orders (e.g., from Odoo backend), the portal picks the newest one. Multiple drafts are not prevented. | Medium | Cancel other drafts on cart creation |
| **G. Cart — Clear cart cancels quotation** | Cancel/delete Odoo draft | **Missing** | `DELETE /api/cart` uses ORM command `[[5, 0, 0]]` to remove all lines but leaves the `sale.order` record in `draft` state. Abandoned empty quotations accumulate in Odoo. | High | Call `action_cancel` or `unlink` on the `sale.order` when clearing cart |
| **G. Cart — Hebrew names in cart** | Yes | **Missing** | `readCartLines` sets `product_name_he` to `line.product_template_id[1]` which is the English display name from the many2one field. Hebrew context not applied. | High | Fetch Hebrew product name separately with `he_IL` context |
| **G. Cart — SKU in cart lines** | Yes | **Missing** | `sku: ''` hardcoded in `readCartLines` (`odoo-helpers.ts` line ~386) | Medium | Read `default_code` from `product.template` for cart lines |
| **H. Checkout — Review page** | Yes | **Complete** | `(customer)/checkout/page.tsx` with items, address, note, totals, confirm button | — | — |
| **H. Checkout — Delivery addresses from Odoo** | Odoo contact children | **Complete** | `fetchDeliveryAddresses` queries `res.partner` children of `commercial_partner_id` | — | — |
| **H. Checkout — Address type filter** | type='delivery' | **Missing** | `fetchDeliveryAddresses` fetches all partner children without filtering by `type='delivery'`. Internal contacts, invoicing contacts, etc. may appear. | High | Add `['type', 'in', ['delivery', 'other']]` to address domain |
| **H. Checkout — No payment** | Correct | **Complete** | No payment UI present | — | — |
| **H. Checkout — Confirm → Odoo action_confirm** | Yes | **Complete** | `api/checkout/confirm` calls `sale.order.action_confirm([[cartId]])` | — | — |
| **H. Checkout — Idempotency** | Yes | **Complete** | State check before `action_confirm`; returns existing order data if already `sale`/`done` | — | — |
| **H. Checkout — No edit after submit** | Correct | **Complete** | No edit/cancel buttons on confirmation or order detail | — | — |
| **H. Checkout — Per-line price+unit** | Both shown | **Partial** | Checkout review shows `line.price_total` but not per-unit or per-pack price alongside each item. Spec requires both. | Low | Add unit price column to checkout items list |
| **I. PDF — Odoo PDF proxy** | Yes | **Complete** | `api/orders/[id]/pdf` proxies `/report/pdf/sale.report_saleorder/` with ownership check | — | — |
| **I. PDF — Download button** | Yes | **Complete** | `orders/[orderId]/page.tsx` has Download button that opens PDF in new tab | — | — |
| **I. Invoices** | Not first release | **Complete** | Not present | — | — |
| **I. Website emails** | Not needed | **Complete** | No email sending from Next.js; Odoo sends order confirmation | — | — |
| **J. Order history — From Odoo** | Yes | **Complete** | `api/orders` queries `sale.order` with `partner_id child_of commercial_partner_id` | — | — |
| **J. Order history — Own orders only** | Yes | **Complete** | `commercial_partner_id` scoping prevents cross-customer access | — | — |
| **J. Order history — Search + date filter** | Yes | **Complete** | `search` (ilike order name) + `date_from`/`date_to` in Odoo domain | — | — |
| **J. Order history — Pagination** | Yes | **Partial** | Pagination UI exists but all orders are fetched from Odoo then sliced in JS (`allOrders.slice(page * perPage, page * perPage + perPage)`). With large order history this is a memory and performance problem. | Medium | Apply `limit` and `offset` in Odoo `searchRead` call |
| **J. Reorder** | Cart rebuild + review | **Missing** | The "Reorder" button in `orders/[orderId]/page.tsx` has no `onClick` handler. It does nothing. | High | Implement reorder: fetch order lines, validate current visibility/price, add to cart, redirect to cart |
| **J. Order lines — Hebrew names** | Yes | **Missing** | `product_name_he` in `api/orders/[id]` is set to `l.product_template_id[1]` (English). | High | Fetch HE names with `he_IL` context |
| **J. Order lines — SKU** | Yes | **Missing** | `sku: ''` hardcoded in order detail lines (`api/orders/[id]/route.ts` line ~93) | Medium | Fetch `default_code` from product template |
| **K. Favorites — Supabase storage** | Yes | **Missing** | `api/favorites/route.ts` uses `const mockFavorites = new Set([10, 11])` at module level — shared across ALL users, reset on redeploy | Launch-blocker | Implement Supabase favorites table per partner_id |
| **K. Favorites — Per-user** | Yes | **Missing** | Same module-level Set is written to by all users. User A sees User B's favorites. | Launch-blocker | See above |
| **K. Favorites — Odoo visibility check** | Yes | **Partial** | Mock mode filters `p.sellable` but uses mock data only. Real Odoo visibility check not implemented. | High | After Supabase integration, validate each favorited template_id against `fetchOdooProducts` |
| **K. Recently ordered — Present** | Yes | **Complete** | `api/recently-ordered` real implementation: queries `sale.order.line` + `fetchOdooProducts` | — | — |
| **K. Recently ordered — Sort option** | Yes | **Complete** | `recently_ordered` sort option in products page dropdown | — | — |
| **K. Recently ordered — Visibility respected** | Yes | **Complete** | Goes through `fetchOdooProducts` which applies website settings filter | — | — |
| **L. Admin — Auth** | Supabase, separate | **Missing** | Login form is a fake stub; any credentials work; no session check | Launch-blocker | Implement Supabase admin auth |
| **L. Admin — No route protection** | Protected | **Missing** | `(admin)/layout.tsx` checks `pathname === '/admin/login'` to skip the nav wrapper but does NOT verify any session. All admin pages accessible without login. | Launch-blocker | Add server-side session middleware or auth check in admin layout |
| **L. Admin — Logs/audit** | Real data | **Missing** | Logs page and audit page exist as navigation items but have not been read (likely stubs). No Supabase writes exist anywhere in codebase. | High | Implement Supabase audit_log writes on admin setting changes |
| **L. Admin — API Health** | Real status | **Missing** | `admin/health/page.tsx` shows hardcoded data (`status: 'ok', latency: '182ms'`). Not live. | Medium | Make health page ping real endpoints on load |
| **L. Admin — Dashboard stats** | Real data | **Missing** | `admin/page.tsx` hardcodes `'12'`, `'7'`, `'Online'`, `'0'` as stat values | Medium | Connect to real Odoo/Supabase queries |
| **L. Admin — Settings** | Website-only | **Partial** | `hide_out_of_stock` setting reads/writes Odoo `ir.config_parameter`. This is real. However this endpoint is accessible without admin auth. | Launch-blocker | Gate behind admin auth |
| **M. Public site** | Minimal | **Complete** | Public homepage, login, terms, privacy, contact pages present | — | — |
| **M. Products before login** | Hidden | **Complete** | All product API routes return 401 without session | — | — |
| **N. Odoo downtime** | Friendly errors | **Complete** | All API routes catch errors and return 503; `OdooUnavailable` component shown in UI | — | — |
| **N. Cart blocked if Odoo down** | Yes | **Complete** | Cart fetches return 503 → `OdooUnavailable` shown; cart mutations also return 503 | — | — |
| **N. Error logging** | Yes | **Partial** | `console.error` on all server errors. No structured logging or Supabase error table. On Vercel this goes to function logs only. | Medium | Add Supabase `error_log` writes for significant failures |
| **O. Security — Odoo secrets in browser** | Never | **Complete** | All Odoo calls are server-side. `ODOO_URL`, `ODOO_DB`, `ODOO_ADMIN_LOGIN`, `ODOO_ADMIN_PASSWORD` are server-only env vars. | — | — |
| **O. Security — Rate limiting** | Planned | **Missing** | No rate limiting on any endpoint including login, search, PDF | High | Implement Upstash Redis rate limiting on login, search, checkout |
| **O. Security — CSRF** | Not addressed | **Unknown** | No CSRF tokens. `sameSite: 'lax'` on session cookie provides partial protection. Explicit CSRF not implemented. | Medium | Review whether `sameSite=lax` is sufficient for your threat model |
| **O. Security — Input sanitization** | Needed | **Missing** | `note` field from checkout is passed directly to Odoo `sale.order.write` without sanitization. Odoo itself escapes it for PDF/email but it's worth noting. | Low | Trim and max-length enforce note on server before writing |

---

## 3. Launch Blockers

Issues that must be fixed before real customers use the system.

| # | Issue | File(s) | Fix |
|---|-------|---------|-----|
| 1 | **Admin area has no authentication.** Anyone can access `/admin` and modify Odoo settings. | `src/app/(admin)/layout.tsx`, `api/admin/settings/route.ts`, `api/admin/categories/route.ts` | Implement Supabase admin auth + server-side session check in admin layout and all `/api/admin/*` routes |
| 2 | **Admin login is a fake stub.** Any credentials succeed and redirect to dashboard. | `src/app/(admin)/admin/login/page.tsx` | Connect to Supabase Auth |
| 3 | **Favorites are shared across all users.** Module-level `Set` in `api/favorites/route.ts` is a server singleton. User A sees and modifies User B's favorites. | `src/app/api/favorites/route.ts`, `src/app/api/favorites/[templateId]/route.ts` | Implement Supabase `favorites` table keyed by `partner_id` |
| 4 | **`SKIP_PORTAL_CHECK=true` in `.env.local`.** Must not reach production. | `.env.local` | Remove flag; verify `verifyPortalUser` is active on prod deploy |

---

## 4. High-Priority Gaps

Important but not strictly blocking if addressed soon after initial deployment.

| # | Issue | File(s) |
|---|-------|---------|
| 1 | **Customer pricelist not used for product price display.** `list_price` shown; pricelist stored in session but ignored. Customers may see wrong prices until cart. | `src/lib/odoo/odoo-helpers.ts` ~L261–274 |
| 2 | **Hebrew names missing from cart lines.** `product_name_he` always copies English. | `src/lib/odoo/odoo-helpers.ts` `readCartLines()` L383 |
| 3 | **Hebrew names missing from order history lines.** Same problem. | `src/app/api/orders/[id]/route.ts` L86 |
| 4 | **Reorder button does nothing.** The button exists and shows in the UI but has no handler. | `src/app/(customer)/orders/[orderId]/page.tsx` L51 |
| 5 | **Clear cart leaves empty draft quotation in Odoo.** Quotation accumulation problem. | `src/app/api/cart/route.ts` `DELETE` handler L44 |
| 6 | **Delivery address list includes all partner children.** Billing-only contacts will appear. | `src/lib/odoo/odoo-helpers.ts` `fetchDeliveryAddresses()` |
| 7 | **Hebrew search does not work.** Search domain uses session language context only; searching Hebrew text when session is `en_US` returns nothing. | `src/app/api/search/route.ts` L28–34 |
| 8 | **Mobile has no category navigation.** Sidebar is `hidden lg:block` with no mobile alternative. | `src/app/(customer)/products/page.tsx` L102 |
| 9 | **No per-customer product visibility.** All customers see the same published catalog. | `src/lib/odoo/odoo-helpers.ts` `fetchWebsitePublishedSettings()` |
| 10 | **Admin settings API unprotected.** Even after admin UI auth is added, the API routes themselves must check admin session. | `src/app/api/admin/settings/route.ts`, `src/app/api/admin/categories/route.ts` |

---

## 5. Medium/Low-Priority Improvements

| Priority | Issue | File(s) |
|----------|-------|---------|
| Medium | Orders list pagination fetches all orders then slices in JS. Slow for customers with large order histories. | `src/app/api/orders/route.ts` L40–59 |
| Medium | SKU is empty string in cart lines and order lines. | `odoo-helpers.ts` L386, `orders/[id]/route.ts` L93 |
| Medium | Currency hardcoded as `'THB'` in product model. Should come from Odoo company or pricelist. | `odoo-helpers.ts` L315 |
| Medium | No debounce on cart quantity updates. Each +/- keystroke fires a network request. | `src/components/cart/CartItem.tsx` |
| Medium | Empty categories not filtered from sidebar. Categories with no visible products still appear. | `src/lib/odoo/odoo-helpers.ts` `fetchOdooCategories()` |
| Medium | Language preference not written to Supabase. Lost when switching browsers or devices. | `src/store/langStore.ts` |
| Medium | Admin dashboard stats and API health page show hardcoded/fake data. | `admin/page.tsx`, `admin/health/page.tsx` |
| Medium | Some UI components use `text-right`/`justify-end` instead of RTL-safe logical properties. | Various components |
| Low | `note` field not sanitized on server before writing to Odoo. | `api/checkout/confirm/route.ts` L68 |
| Low | Checkout review doesn't show per-line unit price (only total). | `(customer)/checkout/page.tsx` L77–91 |
| Low | Public terms/privacy/contact pages are stubs with placeholder content. | `(public)/terms`, `(public)/privacy`, `(public)/contact` |
| Low | No tests of any kind (unit, integration, e2e). | — |
| Low | Admin audit log writes not implemented anywhere. No audit trail for admin actions. | All `api/admin/*` routes |

---

## 6. Odoo Integration Readiness

| Feature | Status | Notes |
|---------|--------|-------|
| **Auth** | ✅ Ready | `odooAuthenticate` + `verifyPortalUser` implemented and tested |
| **Products/categories** | ✅ Ready | Full `fetchOdooProducts` with pagination, sort, translations, tax computation |
| **Website visibility** | ✅ Ready | `product.website.settings` based filtering, OOS admin toggle |
| **Per-customer visibility** | ❌ Not ready | No mechanism to filter by customer/partner-level access |
| **Pricing (list_price)** | ⚠️ Partial | `list_price` is fetched and tax computed. Customer pricelist ignored for browse page display. |
| **Pricing (pricelist)** | ❌ Not ready | `pricelist_id` stored in session but never passed to Odoo product price calls |
| **Packaging** | ✅ Ready | `product.packaging` fetched, validated, and mapped to `product_packaging_qty` in cart lines |
| **Cart draft quotation** | ✅ Ready | Full CRUD on `sale.order` and `sale.order.line` |
| **Cart — Hebrew names** | ❌ Not ready | `product_name_he` in cart lines is wrong |
| **Checkout confirmation** | ✅ Ready | `action_confirm` called; idempotency check in place |
| **Order history** | ✅ Ready | `sale.order` list and detail with `commercial_partner_id` scoping |
| **Order lines — Hebrew + SKU** | ❌ Not ready | Both missing from order line responses |
| **PDF download** | ✅ Ready | Ownership check + Odoo report proxy implemented |
| **Delivery addresses** | ⚠️ Partial | Fetches from Odoo correctly but doesn't filter by address type |
| **Favorites** | ❌ Not ready | No Supabase table. Currently broken in-memory mock. |
| **Admin settings** | ⚠️ Partial | Settings read/write Odoo `ir.config_parameter` — works. But unprotected. |

---

## 7. Mock vs Real Implementation Map

| Feature | Implementation | Notes |
|---------|---------------|-------|
| Login | **Real (Odoo)** | `USE_MOCK_API=false` confirmed |
| Products list | **Real (Odoo)** | `fetchOdooProducts` with caching |
| Product detail | **Real (Odoo)** | Goes through same `fetchOdooProducts` |
| Product images | **Real (Odoo proxy)** | No auth required by Odoo for public images; session forwarded anyway |
| Categories | **Real (Odoo)** | `fetchOdooCategories` with hidden-ids filter |
| Search | **Real (Odoo)** | `fetchOdooProducts` with domain |
| Recently ordered | **Real (Odoo)** | Queries `sale.order.line` then `fetchOdooProducts` |
| Cart GET | **Real (Odoo)** | `findCart` + `readCart` |
| Cart add line | **Real (Odoo)** | Creates/updates `sale.order.line` |
| Cart update qty | **Real (Odoo)** | PATCH with ownership check |
| Cart delete line | **Real (Odoo)** | DELETE with ownership check |
| Cart clear | **Real (Odoo — partial)** | Removes lines but does not cancel the order record |
| Checkout review | **Real (Odoo)** | Cart + delivery addresses from Odoo |
| Checkout confirm | **Real (Odoo)** | Calls `action_confirm` |
| Order list | **Real (Odoo)** | `sale.order` with commercial_partner scoping |
| Order detail | **Real (Odoo)** | Full order read with lines and shipping address |
| Order PDF | **Real (Odoo proxy)** | Proxies `/report/pdf/sale.report_saleorder/` |
| Favorites GET | **Mocked (in-memory)** | Shared Set, not per-user, lost on restart |
| Favorites POST | **Mocked (in-memory)** | Same |
| Favorites DELETE | **Stub** | Returns `{ removed: true }` immediately, does nothing |
| Admin login | **Stub** | 800ms delay then redirect — no auth |
| Admin settings | **Real (Odoo)** | Reads/writes `ir.config_parameter` — but unprotected |
| Admin categories | **Real (Odoo)** | Reads/writes hidden category IDs — but unprotected |
| Admin dashboard | **Hardcoded fake** | All stats are static strings |
| Admin health | **Hardcoded fake** | Static table, not live checks |
| Admin logs | **Unknown (likely stub)** | Not read; no Supabase writes in codebase |
| Admin audit | **Unknown (likely stub)** | Not read; no Supabase writes in codebase |

---

## 8. Security Review

| Finding | File | Severity | Detail |
|---------|------|----------|--------|
| **Admin area entirely unprotected** | `src/app/(admin)/layout.tsx` L19 | Critical | `if (pathname === '/admin/login') return <>{children}</>` — there is no else block that checks authentication. All other admin pages render freely for any visitor. |
| **Admin API routes have no auth check** | `api/admin/settings/route.ts`, `api/admin/categories/route.ts` | Critical | Both routes use `getAdminSession()` which authenticates as the Odoo admin — not the web admin user. They do not check whether the web request came from an authenticated admin. Any visitor can POST to `/api/admin/settings` and change `hide_out_of_stock`. |
| **Fake admin login** | `src/app/(admin)/admin/login/page.tsx` L13–18 | Critical | `handleLogin` ignores credentials entirely. Always succeeds. |
| **Favorites are a global shared Set** | `src/app/api/favorites/route.ts` L4 | Critical | `const mockFavorites = new Set([10, 11])` — module-level, shared across all server requests. User A can see and remove User B's favorites. |
| **`SKIP_PORTAL_CHECK=true`** | `.env.local` | High | If deployed to production, any Odoo internal user can log in as a customer. Must be removed. |
| **Session cookie not `Secure` in dev** | `api/auth/login/route.ts` L73 | Low | `secure: process.env.NODE_ENV === 'production'` — acceptable for dev but worth noting for staging if served over HTTP. |
| **Image proxy reads and parses session cookie** | `api/images/product/[id]/[size]/route.ts` L17–22 | Low | JSON-parses the raw session cookie value. If cookie is tampered, the `try/catch` absorbs it. The endpoint does not check session ownership of the product ID, but images are not sensitive. |
| **No rate limiting** | All API routes | High | Login bruteforce, PDF download spam, cart flooding — all unmitigated. |
| **Order history fetches all then paginates in JS** | `api/orders/route.ts` L40–59 | Medium | For customers with hundreds of orders, this fetches all from Odoo into memory then slices. Not a security issue but a DoS risk under load. |
| **Odoo admin credentials in server env** | `.env.local` | Low | `ODOO_ADMIN_LOGIN` / `ODOO_ADMIN_PASSWORD` are server-only env vars. Never exposed to browser. Risk is git leak — `.gitignore` correctly excludes `.env.local`. Confirm Vercel env vars are set separately. |

---

## 9. Data Ownership Review

| Data | Should own | Currently owns | Verdict |
|------|-----------|----------------|---------|
| Portal users | Odoo | Odoo | ✅ Correct |
| Product catalog | Odoo | Odoo | ✅ Correct |
| Product images | Odoo | Odoo (proxied) | ✅ Correct |
| EN/HE product names | Odoo | Odoo | ✅ Correct |
| Product pricing | Odoo (pricelist) | Odoo `list_price` + client-side tax math | ⚠️ Partially wrong — pricelist ignored for display |
| Cart | Odoo (sale.order draft) | Odoo | ✅ Correct |
| Cart totals | Odoo | Odoo | ✅ Correct |
| Sales orders | Odoo | Odoo | ✅ Correct |
| Order PDFs | Odoo | Odoo | ✅ Correct |
| Delivery addresses | Odoo (res.partner) | Odoo | ✅ Correct |
| Ecommerce categories | Odoo | Odoo + portal hidden-IDs in `ir.config_parameter` | ✅ Correct — hidden state is portal metadata, not business data |
| OOS visibility toggle | Portal setting (stored in Odoo ir.config_parameter) | Odoo | ✅ Correct per design |
| Favorites | Supabase | In-memory module Set | ❌ Wrong — not persisted, not per-user |
| Language preference | Supabase | Browser cookie only | ❌ Partial — cookie is browser-local only |
| Admin users | Supabase | Not implemented | ❌ Missing |
| Admin audit logs | Supabase | Not implemented | ❌ Missing |
| Error logs | Supabase | `console.error` only | ❌ Missing |
| Admin dashboard stats | Supabase/Odoo | Hardcoded | ❌ Wrong |
| API health status | Real (live checks) | Hardcoded | ❌ Wrong |

---

## 10. UX Review

### Desktop
- ✅ Clean layout with sticky navbar, sticky sidebar, paginated product grid
- ✅ Cart hover popover with line preview
- ✅ Breadcrumb navigation on new arrivals and order detail
- ✅ Loading skeletons on product grid
- ✅ Error state (`OdooUnavailable`) with retry on all key pages
- ✅ Empty states with actionable links
- ⚠️ Checkout review doesn't show per-unit price alongside each line item
- ⚠️ Checkout confirm button is disabled if no delivery addresses exist, but there is no message explaining why
- ❌ Admin dashboard shows hardcoded fake data — looks real but is meaningless

### Mobile
- ✅ Navbar collapses to hamburger menu
- ✅ Product grid is 2-column on mobile
- ❌ No category navigation on mobile — sidebar is `hidden lg:block` with no mobile drawer/sheet. A customer on mobile cannot browse by category.
- ❌ Cart line items may be cramped on small screens (image + name + price + qty controls in a single row)

### English
- ✅ Full translation coverage (90+ keys)
- ✅ Google Fonts Inter loaded
- ✅ Correct date formatting (`formatDate` uses `en-GB`)

### Hebrew / RTL
- ✅ `dir="rtl"` set on `<html>` from server cookie
- ✅ Font switches to Rubik
- ✅ Most Tailwind classes use logical properties (`ps-`, `pe-`, `ms-`, `me-`, `text-start`, `text-end`)
- ✅ Logo SVG `dir="ltr"` fix in place (recently fixed)
- ❌ Hebrew product names not shown in cart lines or order history lines
- ⚠️ Some UI strings are hardcoded in English: "Delivery Address", "Items", "Subtotal", "Order Note" in order detail page (`orders/[orderId]/page.tsx` L59, L65, L86, L97) — not using `t(lang, ...)` 
- ⚠️ `orders/[orderId]/page.tsx` uses `{t(lang, 'orders.title')}` as a back-button label which reads "Order History" — misleading as a back button
- ⚠️ Checkout review "Order Items" heading is hardcoded English

### Loading States
- ✅ Skeleton cards on products page during load
- ✅ `LoadingSpinner` on cart, checkout, order detail, favorites
- ✅ Button loading states (`loading` prop on `Button` component)

### Empty States
- ✅ Cart empty state with "Browse Products" CTA
- ✅ Favorites empty state with "Browse Products" CTA
- ✅ Orders empty state
- ✅ New Arrivals empty state with "Browse All Products" button

### Error States
- ✅ Odoo unavailable shown on products, cart, checkout, orders
- ✅ 503 detection on all key pages
- ❌ No error shown if PDF download fails (opens a blank tab)
- ❌ No error boundary at the app level (unhandled client error would show Next.js error screen)

---

## 11. Recommended Fix Plan

### Phase 1 — Launch Blockers (must fix before any real user)

1. **Implement Supabase admin auth.** Create admin session table in Supabase. Connect `/admin/login` to Supabase Auth. Add session check to admin layout. Add auth middleware to all `/api/admin/*` routes.
2. **Remove `SKIP_PORTAL_CHECK=true`** from `.env.local` and verify it is absent from Vercel production env vars.
3. **Implement Supabase favorites.** Create `favorites` table (`partner_id, template_id, created_at`). Replace the in-memory Set in `api/favorites/route.ts` and `api/favorites/[templateId]/route.ts`.
4. **Protect admin API routes independently.** Even after UI auth is added, `api/admin/settings` and `api/admin/categories` must verify an admin session cookie before proceeding.

### Phase 2 — Odoo Integration Blockers (fix before scaling to real customers)

5. **Hebrew names in cart lines.** In `readCartLines`, fetch product names with `he_IL` context for the `product_name_he` field.
6. **Hebrew names in order lines.** Same fix for `api/orders/[id]/route.ts`.
7. **Hebrew search.** Run dual-language search (EN + HE context) and merge results.
8. **Reorder implementation.** Fetch order lines, validate current product visibility, add to cart, redirect to cart review.
9. **Clear cart cancels Odoo quotation.** Replace `[[5, 0, 0]]` with `action_cancel` + `unlink` (or at minimum `action_cancel`) on the `sale.order`.
10. **Delivery address type filter.** Add `['type', 'in', ['delivery', 'other', False]]` to `fetchDeliveryAddresses` domain.
11. **Customer pricelist pricing.** Pass `pricelist_id` in Odoo context when fetching product prices, so browse page shows what the customer actually pays.
12. **Mobile category navigation.** Add a category filter sheet/drawer for mobile (e.g., triggered by a "Categories" button above the product grid).
13. **SKU in cart and order lines.** Fetch `default_code` and include in line responses.

### Phase 3 — Polish and Future Improvements

14. Add debounce (400–600ms) to cart quantity +/– controls.
15. Server-side pagination for order history (`limit`/`offset` in Odoo query).
16. Write Supabase error logs for significant server failures.
17. Write Supabase audit logs for admin actions (who changed what and when).
18. Connect admin dashboard to real Odoo/Supabase queries.
19. Make admin health page perform live checks.
20. Add rate limiting on login, search, PDF, and checkout endpoints (Upstash Redis recommended).
21. Filter empty categories from sidebar.
22. Fix hardcoded English strings in order detail and checkout pages.
23. Write language preference to Supabase on language switch.
24. Add global React error boundary.

---

## 12. Questions for Tal

1. **Per-customer product visibility:** Does the business need product-level restrictions per customer/company, or is the current site-wide publication model sufficient? If restrictions are needed, are they managed via Odoo pricelists, a custom Studio field on `res.partner`, or another mechanism?

2. **Pricelist pricing on browse page:** Should product browse pages show the customer's pricelist price, or is showing list_price acceptable and the customer only sees their real price at cart/checkout? This affects how we call Odoo for pricing.

3. **Consumable products and stock:** Your catalog appears to use `type='consu'` for all products. Should OOS filtering apply to consumables at all? Or should consumables always be visible regardless of `qty_available`?

4. **Favorites timeline:** Is Supabase integration for favorites required before any customer can use the portal, or is it acceptable to launch without favorites and add them shortly after?

5. **Reorder flow details:** When a customer reorders, should products that are now hidden/OOS be silently skipped, or should the customer be shown a warning list of items that could not be added?

---

## What I Recommend Doing Next

**Immediately (before showing to any real customer):**
Fix the admin authentication gap — it is the only issue that allows external modification of your Odoo configuration without any credentials. This is a one-session task: Supabase project + admin user table + session cookie in admin layout + API route guard.

**Next sprint:**
Implement Supabase favorites (the in-memory bug is a data integrity issue for multi-user use), then tackle Hebrew cart/order line names and the reorder feature, which together make the Hebrew customer experience complete and the order history page actually useful.
