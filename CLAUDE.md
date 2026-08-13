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
| `USE_MOCK_API` | Set to `false` for real Odoo; anything else uses mock data. **On Vercel (`VERCEL` env present), middleware 503s every request unless the value is exactly `false`** so a misconfig fails loudly instead of serving fake data. Local prod-build mock testing still works (no `VERCEL` var). |
| `ODOO_WEBSITE_ID` | Odoo website ID (currently `3`) |
| `ODOO_STOCK_WAREHOUSE_CODE` | FALLBACK warehouse code for stock scoping (default `R4`). The sellable warehouse is normally read from the website record (`website.warehouse_id` = Rama 4), so the portal auto-follows if it changes in Odoo; this code is only used if the website has no warehouse set. The global `qty_available` nets stock across all ~20 companies + internal locations and is wrong; every stock read is scoped to the warehouse's `lot_stock_id` ("R4/Stock") and its children. Resolved to a location id at runtime (`getSellableLocationId`, cached 1 day). If unresolved, reads fall back to the global value (fail open). |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (favorites, announcements, login rate limiting, scheduled orders). Server uses the service-role key. |
| `SKIP_PORTAL_CHECK` | Dev only — skips the portal-user check on login. **Fatal 500 in production** if set to `true` (guard in the login route). |
| `ADMIN_EMAILS` | Comma-separated allowlist of emails permitted to hold an admin session. Falls back to `ODOO_ADMIN_LOGIN` if unset. Both admin login paths (Odoo + Supabase) are gated by this. |
| `CRON_SECRET` | Bearer token the scheduled-orders cron must send (`Authorization: Bearer <CRON_SECRET>`). Vercel injects this into its cron requests. |
| `RESEND_API_KEY` / `EMAIL_FROM` | Resend transactional email (scheduled-order placed/failed notifications). **Currently unset by design — email is off.** When unset, `sendEmail` is a quiet no-op; the feature works and customers rely on the `/scheduled-orders` status page. To enable later: verify a TKP sender domain in Resend, set both vars, redeploy. |

## Deployment
- **Vercel account**: `tal@kosher-place.com` (TKPAPPS team)
- **Project**: `tkp-wholesale` — `prj_FhdXBreMoTUpsE5MgE8oxgFuELgo`
- **Team**: `team_p1fOxoCiPu2Hj4jqkBZu22AT`
- **Prod domain**: `wholesale.tkpapps.com` (custom, verified) + `tkp-wholesale.vercel.app`
  (both serve the app, no redirect between them). The app has NO hardcoded base URL —
  all absolute redirects use `req.url` (host-relative), so it works on any attached domain.
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

**Availability is freshness-overlaid on every cached product read.** `fetchOdooProducts`
(the uncached wrapper around `_fetchProductsCached`) re-resolves each returned product
against the CURRENT cached sets — in-stock ids (60s), published settings, hidden products —
and drops products that were unpublished/hidden since the page was cached, drops
now-unorderable products when hide-OOS is on, and corrects `in_stock`/`sellable` flags.
So a product that just sold out disappears from every listing-family surface (grid, detail,
featured, best-sellers, favorites, recently-ordered, quick-order) within ~1 min instead of
the page cache's 5. Costs no extra Odoo call when the sets are warm. A short page / slightly
stale `total` mid-window is accepted; order-time enforcement was already fully live
(`getAvailableUnitsForOrdering` at cart-add, `findUnorderableTemplateIdsLive` at checkout).

**Instant cache flush after Odoo-side edits:** admin-panel changes bust tags immediately,
but edits made directly in the Odoo backend (unpublish, archive, `sale_ok` off) have no
hook, so they wait out the TTL. Hit `GET|POST /api/revalidate-products` to flush all
product-availability tags now. Auth: `Authorization: Bearer $CRON_SECRET` OR
`?secret=$CRON_SECRET` (the query-param form exists because Odoo's webhook action cannot
set custom headers). **Automating this from Odoo is written up and ON HOLD pending a
possible domain change: see `docs/odoo-cache-invalidation-automation.md`.**

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

**Card prices are fiscal-position-aware.** Product prices are stored tax-inclusive (Output
VAT 7% incl). Some customers use a "NO VAT" fiscal position (`res.partner.property_account_
position_id`) that removes VAT (Chabad branches, Phuket, ...). The price preview in
`_fetchProductsCached` now: (1) filters the product's taxes to the WEBSITE's company
(`getWebsiteCompanyId`, website 3 = company 1) — products are shared across ~20 companies and
carry a 7% VAT tax each, so without this filter other companies' VAT leaks in; (2) strips the
product's own included VAT to get the ex-tax base; (3) re-adds only the customer's EFFECTIVE
tax after mapping through their fiscal position (`getFiscalTaxMap`). So a NO-VAT customer sees
the ex-VAT price on the card, matching what Odoo charges at checkout (verified: Gravlax ฿130
list -> ฿121.50 for NO VAT). `fiscalPositionId` is resolved per-request (`getPartnerFiscalPositionId`)
and threaded into `fetchOdooProducts` (part of the cache key), so it's applied on the listing,
detail, featured, best-sellers, recently-ordered, favorites, and quick-order. The shared
`computeDisplayUnitPrice(basePrice, taxes, fiscalMap, websiteCompanyId)` encapsulates the
company-filter + strip-included-VAT + apply-fiscal-map steps; both the grid and `/api/search`
call it so they can't drift. (Search is still list_price-based, not pricelist-adjusted — a
preview — but its VAT/fiscal handling now matches the grid.)

**Stock is scoped to one warehouse location (R4/Stock).** Odoo's `qty_available` is
global (nets all ~20 companies + every internal location), so it is the wrong number for
the storefront. `getSellableLocationId()` resolves `ODOO_STOCK_WAREHOUSE_CODE` (default
`R4`) to its `lot_stock_id` and `stockLocationContext()` returns `{ location: id }`, which
is merged into the context of every `qty_available` read: `_fetchInStockIds` (the visible
set + `sellable` flag), the per-card read in `_fetchProductsCached` (the low-stock badge),
the search route's per-hit read, and `findUnorderableTemplateIdsLive` (checkout re-check).
Odoo's qty_available honours a `location` context and includes child locations, so this one
id covers "R4/Stock and all child paths". Resolution is cached 1 day; if it fails, reads
fall back to global (fail open) so a misconfig never empties the catalog. **Search results
(`SearchHit`) now carry `sellable`/`in_stock`/`qty_available` + a per-unit price** — the
global search overlay and quick-order previously omitted these, so out-of-stock items
rendered as in-stock (and in-stock items as OOS) with a ฿0 unit price on those surfaces.

**Checkout stock recheck + out-of-stock separation.** A cart can sit for days, so both the
checkout review (`/api/checkout/review`) and the final confirm (`/api/checkout/confirm`)
re-check stock via `findUnorderableTemplateIdsLive` — a LIVE per-item `qty_available` read
for just the cart's template ids (not the 60s-cached whole-catalog set), so a recent stock
drop can't slip an OOS item into a placed order. It's cheap because a cart is a small id
set. Same orderability rule as `_fetchInStockIds` (type `consu` AND (not `is_storable` OR
`qty_available>0`), OR `allow_out_of_stock_order`); fails open (empty set) on a lookup error.
The checkout page splits the cart into orderable vs out-of-stock and shows the OOS items in a
separate amber section; the order total reflects only orderable lines. Confirm returns 409
`CART_NEEDS_ADJUSTMENT` (with `template_ids` for OOS + `qty_exceeded_template_ids` for
over-quantity lines, see below) when either issue is present and the client has not
acknowledged; the client re-fetches review and the button becomes "Remove out-of-stock items
and place order" / "Reduce quantities and place order" / "Adjust cart and place order"
(whichever applies), which POSTs `remove_unavailable:true`. Confirm then `unlink`s the OOS
`sale.order.line`s, places the order with the rest, and returns `removed_count` (surfaced as a
banner on the confirmation page via `?removed=N`). If EVERY line is OOS it returns 409
`ALL_ITEMS_OUT_OF_STOCK`.

**Cart quantity is capped to available stock.** A customer could previously add e.g. 200 units
of a product with only 5 in stock — no path (add, edit, reorder, quick-order) ever compared
the requested quantity to `qty_available`. `getAvailableUnitsForOrdering(sessionId,
templateIds)` (`odoo-helpers.ts`, batched, next to `findUnorderableTemplateIdsLive`) returns,
per template id, the R4-scoped available UNITS to order, or `null` if unlimited
(`allow_out_of_stock_order`, or a non-storable/untracked consumable — same "always in stock"
rule as `_fetchInStockIds`; fails open on a lookup error). `POST /api/cart/lines` and `PATCH
/api/cart/lines/[lineId]` are the sole write paths (reorder/quick-order/bulk-order all funnel
through POST), so enforcing there covers everywhere: both sum the units already committed to
that TEMPLATE across ALL the cart's lines (not just the matching packaging/variant — otherwise
splitting an order across "Unit" and "Case of 12" lines would bypass the cap), add the new
request, then CLAMPS it down to a whole number of packs that fits within what's left rather
than rejecting — asking for 50 when 37 are available adds 37 and the response carries
`adjusted_packs: 37` (the cart JSON is spread with this one extra field) so the client shows an
informative toast ("Only 37 available — added 37" / "— quantity updated to 37") instead of an
error. A 409 `INSUFFICIENT_STOCK` (`{message, available_units, available_packs}`) is returned
only when literally nothing more can be added/kept (e.g. sibling lines for the same template
already consume everything available). `allow_out_of_stock_order` ("Continue Selling if Out of
Stock") means fully UNLIMITED — no cap at all, regardless of real stock level. That's a
deliberate merchant opt-out, not just "don't block ordering exactly at zero"; do not reintroduce
a positive-stock cap for these products. `cartStore.ts`'s `addToCartAndSync`/`updateLineQty`
resolve `{ok, message?, adjustedPacks?}` so callers can distinguish "as asked" from "reduced"
from "failed outright". `computeMaxPacks()` (`src/lib/utils.ts`) informs the `QuantitySelector`
`max` prop (used for the grid, product detail, packaging switch) and the "Only N available" hint
text — but `max` no longer restricts TYPING in the input (only the +/- buttons respect it):
typing is always accepted and passed straight to `onChange`, so the field never fights the user
mid-keystroke. The server is authoritative and always re-validates/clamps on Add.

**Cart store: mutation responses always win over a concurrent background refresh.** Confirmed
bug: editing a line to a quantity that got server-clamped (e.g. 400 -> 3, only 3 in stock) wrote
correctly to Odoo, but the cart page kept showing the customer's original invalid input. Root
cause: `cart/page.tsx` used to keep its own separate, unsequenced `fetch('/api/cart')` + `setCart`
on mount, entirely bypassing the store's `seq`/`appliedSeq` staleness guard — a background
refresh could land at any time and silently clobber a just-applied mutation with no ordering
check at all. Fixed two ways: (1) `cart/page.tsx` now calls the store's own `fetchCart()`
instead of a parallel local implementation (which now also drives `isLoading`/`odooUnavailable`
directly, so the page no longer needs to manage them itself); (2) the store's mutation methods
(`addToCartAndSync`/`updateLineQty`/`removeLine`) apply their own response via `applyMutation()`
(always wins, still bumps `appliedSeq` forward so it can't itself be undone by something older)
rather than the strict `reconcile()` gate used only by the plain background `fetchCart()` — a
direct mutation is the confirmed result of the action the user just took and must never be
silently dropped just because an unrelated background refresh happened to resolve first.
`CartItem`'s local qty input resyncs from the `line` object (not `line.packaging_qty`) on every
cart refresh — a clamped/unchanged update can leave the true server value numerically the same
as before the edit, and a dependency on just the primitive would then never re-fire.
Checkout gets the same safety net for carts that sat and stock dropped since: confirm sums
per-template committed units among lines whose template IS orderable (an unorderable
template's lines are removed entirely, not clamped) and, on acknowledgment, clamps each
over-quantity line down to a whole number of packs that fits (allocated across that template's
lines in order; a line clamped to 0 packs is unlinked), returning `adjusted_count` (banner via
`?adjusted=N`). `addToCartAndSync`/`updateLineQty` (`cartStore.ts`) resolve `{ok, message}`
(not a bare boolean) so a rejection's reason reaches the toast instead of a generic error.

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

**New arrivals = product.template `create_date` within the window** (NOT the
`product.website.settings` publish-record date). `/new-arrivals` sends `sort=new_arrivals`
+ `created_after=<now - newArrivalsDays>`; `_fetchProductsCached` pushes
`['create_date','>=',created_after]` into the same `product.template` query as the listing,
then applies the normal visibility filter (published on `WEBSITE_ID` + in-stock + not hidden).
So a product only shows if it is BOTH recently created AND published to the portal.
**Migration gotcha (caused an empty list on the 2026-06 staging swap):** an Odoo DB
import/migration can bulk-stamp `product.website.settings.create_date` with the import
timestamp — the old logic keyed off that field and went silently empty. Keying off the
product's own `create_date` is the stable signal, but if a *full* re-import also resets
template `create_date`, OR no product has been published within `newArrivalsDays`, the list
is legitimately empty. **When switching the Odoo DB (esp. the launch cutover), sanity-check
New Arrivals:** count `product.template` rows with `create_date >= cutoff` that are published
on website 3; if 0, widen `newArrivalsDays` in Admin → Settings or publish newer products
rather than assuming a code bug.

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
quick-order, and navbar mini-cart. Product-grid cards + search results request `image_512`;
the product detail page uses `image_1024`; cart/mini-cart thumbnails use `image_128`.
(Bumped from 256/512/128 on 2026-07-15: grid cards are ~300px = ~600px on retina, detail can
be ~640px CSS; Odoo returns the smaller rendition when the larger isn't uploaded, so low-res
source products are unchanged. Still AVIF/WebP q75 + edge-cached, so a few KB more per image.)
Note: a `public` edge cache
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
- **`price_per_pack` on cart lines is TAX-INCLUSIVE** (since 2026-07-15):
  `readCartLines` derives it as `price_total / packs` so pack price × qty always
  equals the displayed line total and matches the cards + optimistic line. Do not
  rebuild it from `price_unit` (ex-VAT); that made cart math look wrong.

## Mobile layout constraints (360px is the design floor)
Verified in headless Chrome at 360 and 390px; every customer page measures
`scrollWidth == clientWidth` (no horizontal scroll). Three things make this fragile, so
check them whenever you touch a row that holds a price or a control:

- **`formatCurrency` emits a NON-BREAKING space** (U+00A0) between code and amount, so
  "THB 1,234,567.00" is a single unbreakable ~139px run at `text-sm`. Money can never wrap
  to relieve a cramped flex row. Give such rows `flex-wrap`, or pin the money `shrink-0`.
- **`html { font-size: 112.5% }`** means root = 18px, so every rem utility is 1.125x bigger
  than the Tailwind name suggests (`w-6` = 27px, `text-4xl` = 40.5px) while breakpoints stay
  in px. Budget widths in real px, not in Tailwind units.
- **Usable width at 360px** is 324px inside `main px-4`; a 2-col product card is ~117px
  inside its padding. That does not fit a stepper beside a button, which is why
  `ProductCard` stacks them below `sm`.

Fixed here, do not regress: `QuantitySelector` buttons carry `shrink-0` (without it they
collapsed to ~17px tap targets); the navbar shows the language switcher only at `md+` and
puts it in the mobile menu instead (all five top-bar controls together pushed the hamburger
37px off screen at 360px, making the menu unreachable); `Toast` sits at `bottom-20` so it
clears the `BottomNav` it used to cover.

## Customer navigation & UI
- **Top nav** (`Navbar.tsx`): desktop (`md+`) = Home · Products · New Arrivals · Best
  Sellers · Quick Order · `Orders ▾` (Orders / Recently Ordered / Scheduled / Invoices) ·
  Favorites. The logo and the post-login redirect both point to `/dashboard` (Home); the
  dashboard's one-click Reorder is the core repeat-buyer flow. Dropdowns live in
  `NavMenus.tsx` (`NavOrders`, hover-intent). Right side:
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
- **Language resolution:** the Odoo profile lang applies ONLY on a first-ever visit (no
  `lang` cookie). `(customer)/layout.tsx` captures `hasLangCookie()` BEFORE `initLang()`
  (which writes the cookie). Do not re-add an unconditional `setLang(profile)` on
  `/api/auth/me`, it stomped manual language choices on every reload.
- **/products layout order:** breadcrumb → toolbar (search/sort/in-stock) → Featured strip →
  grid. The toolbar must stay ABOVE Featured; repeat buyers land here to find a SKU.
- **Error boundaries:** `src/app/global-error.tsx` (dependency-free, own html/body) +
  `src/app/(customer)/error.tsx` (branded retry, keeps Navbar mounted). Both call
  `reportClientError(boundary, error)` from `src/lib/report-client-error.ts` — a ZERO-import
  module (so global-error's can-never-crash rule holds) that POSTs `{boundary, message,
  digest, stack, url}` to `/api/client-error` with `keepalive: true` (survives the reflexive
  reload on a crash page) and a `WeakSet` per-error dedupe (StrictMode double-invoke, effect
  re-fires). Effect deps must be `[error]` ONLY — depending on `lang` re-posted duplicates
  when the store hydrated post-mount. `lang` is not in the client payload at all: the route
  reads the request's own `lang` cookie. The route `console.error`s a structured record so
  crashes show under `vercel logs --level error` — this app has no Sentry, so boundary
  crashes were previously invisible server-side. The endpoint is public/unauthenticated on
  purpose (can fire pre-login), guarded by an IN-MEMORY per-instance 20/10min limiter that
  fails CLOSED (deliberately NOT the Supabase `checkRateLimit`, whose fail-open policy is
  right for login but wrong for a public log-write endpoint) plus a 32KB content-length cap.
  KNOWN LIMITS (accepted follow-ups): only React render crashes reach boundaries — event
  handler errors and unhandled promise rejections are still unreported (would need
  window `error`/`unhandledrejection` listeners); and reports live only as long as Vercel
  log retention — for longer-term forensics add a durable sink (Supabase table / log drain).

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

## Storefront strips, price sort & low-stock rule
- **Sort by price** (`sort=price_asc`/`price_desc`) orders by the customer's *resolved pricelist
  price*, not `list_price` (Odoo can only sort by `list_price`, which looked "mixed"). The route
  uses `getPriceOrderedIds(pricelistId)` — a cached (10 min, per pricelist) full-catalog list of
  visible template ids ordered by effective price — intersects it with the selected category,
  pages by id, then re-imposes the order. With no pricelist it falls back to `list_price asc/desc`.
- **Best sellers** (`/api/best-sellers`, strip on `/products` page 0): `getBestSellerIds()` ranks
  templates by confirmed-order-line frequency. `sale.order.line.product_template_id` is NOT
  stored, so it groups by the stored `product_id` (variant) and rolls counts up to templates;
  service lines (Delivery, etc.) rank high but are dropped by storefront visibility. Cached 1h.
  No admin curation (unlike Featured, which stays manual via `b2b_portal.featured_template_ids`).
- **Low-stock badge rule:** shows when `qty_available > 0 AND qty_available < lowStockThreshold`
  (default 20, tunable 0-100000 in Admin → Settings → `b2b_portal.site_settings`). Rendered in
  `ProductCard.tsx`. Out-of-stock (qty 0) products show the OOS state, not the low-stock badge.

## Scheduled / repeating orders
- **Data:** Supabase `scheduled_orders` (service-role, RLS-off) + `claim_scheduled_order(id, today)`
  RPC. `items` is a JSONB snapshot `[{product_id,name,name_he,sku,uom_qty,packaging_id,packaging_qty}]` —
  never prices (Odoo computes the live pricelist price at placement). All dates are **Asia/Bangkok**
  calendar dates; date math lives in `src/lib/schedule-dates.ts` (`todayBkk`, `addDays`, `nextRunDate`),
  which is also used by the Part-A timezone fixes.
- **Creation:** `POST /api/checkout/confirm` accepts an optional `schedule` object; after `action_confirm`
  it snapshots the confirmed order's lines (`readOrderItemsForSchedule`) and inserts the row. Best-effort:
  a failure returns `schedule_error` (order still placed), surfaced on the confirmation page.
- **Executor:** `/api/cron/scheduled-orders` (Vercel cron `30 23 * * *` = 06:30 Bangkok, `maxDuration=300`),
  authed by `Authorization: Bearer $CRON_SECRET`. Per due schedule, sequentially: claim RPC → Odoo-side
  `client_order_ref` recovery check → address re-validate (fallback to the commercial partner's own
  address) → create `sale.order` (**NO `pricelist_id`, NO `website_id`** — else `findCart` adopts it as a
  cart) → create all lines in one call (no `price_unit`) → `action_confirm` → advance `next_run_date` →
  Resend email. On failure: don't advance, increment `consecutive_failures`, email, auto-pause after 3.
- **Idempotency (both required):** the claim RPC stamps `last_run_date` before any Odoo call (a mid-run
  timeout can't double-place same day); the deterministic `client_order_ref` recovers a crash-after-confirm.
- **Management:** `GET /api/scheduled-orders`, `PATCH|DELETE /api/scheduled-orders/[id]` (ownership via
  `commercial_partner_id` in the query), page at `/scheduled-orders`, linked from the Orders dropdown +
  mobile nav.

## Session tokens carry expiry
- Both the customer `session` cookie (`signSession` in `src/lib/odoo/session.ts`) and the admin token
  (`signAdminToken` in `src/lib/supabase.ts`) now embed `iat`/`exp`; verification rejects expired tokens
  regardless of the client-controlled cookie maxAge. Old unsigned/no-exp tokens are rejected — users
  re-login once. Admin access additionally requires the email to be on `ADMIN_EMAILS`.

## Odoo 18 gotchas (verified on the staging8 DB)
- **`sale.order` has NO `commercial_partner_id` field.** Reading it throws
  `Invalid field 'commercial_partner_id' on model 'sale.order'`. This silently broke every
  order-detail + PDF view (assertOrderOwnership returned ORDER_NOT_FOUND for everyone). Verify
  order ownership with a `['partner_id','child_of',commercialPartnerId]` search instead.
  `commercial_partner_id` IS valid on `res.partner`.
- **No `storable`/`product` product type.** Physical goods are all `type='consu'`; only
  `is_storable=true` ones track inventory. Non-storable consumables always report
  `qty_available=0` but are perpetually orderable — treat them as in stock. The in-stock id set
  is `type='consu' AND (is_storable=false OR qty_available>0)`. `in_stock` for the card is
  derived from that same set so visibility and the displayed flag can't contradict.
- **Pricing is Odoo-native, not reimplemented.** Carts are created with `partner_id` only (no
  `pricelist_id`) so Odoo assigns the partner's current `property_product_pricelist`; cart lines
  are created/updated WITHOUT `price_unit` so Odoo computes the exact pricelist price. Never
  write `price_unit` manually. The customer's pricelist is resolved server-side via
  `getPartnerPricelistId(partnerId)` (cached 5 min) instead of the login cookie, so pricelist
  changes in Odoo take effect without re-login. The product LISTING still resolves prices in JS
  (`buildPlPriceMap`, a preview that reconciles to Odoo's exact price in the cart) and now
  handles all rule types: `3_global`, `2_product_category` (matched via `product.category.parent_path`
  ancestry), `1_product`, `0_product_variant`, honouring `min_quantity`.
- **Language-stable sort.** The product listing default sort orders by `default_code` (SKU),
  which is language-independent, so switching EN/HE doesn't reshuffle the grid. `sort=name` is
  an explicit localized alphabetical option (Odoo orders by the active language's name).

## Company scoping (multi-company safety)
> **Reads of a customer's OWN res.partner row must pass `{ scopeToCompany: false }`.**
> 336 of 583 active users have a partner record OWNED by a sibling company. Under the
> company scope, `read()` on such a record raises AccessError (a 503 on pricing, VAT, the
> address picker and the invoice bill-to block) and `search_read()` silently returns nothing
> (a delivery address that just vanishes from the picker). Dropping the scope is safe there:
> the record is the caller's own, and the API user's default company IS company 1, so
> company-dependent properties still resolve against company 1. Never use the opt-out for
> business documents (sale.order, account.move, stock) - that is the leak this all closed.

> **NEVER apply `allowed_company_ids` to a CUSTOMER web session.** Odoo raises
> `AccessError("Access to unauthorized or invalid company")` whenever the context names a
> company the acting user does not belong to, and **503 of 555 active portal users sit on
> sibling companies** (mostly Jcafe Sukhumvit, id 15), not company 1. Forcing the scope on
> that path locked them out of the portal entirely: Odoo accepted the password, the next
> call threw, and login answered 503. The scope belongs on the admin (`uid:apikey`) path
> only, which is where every customer-visible query already runs. The customer session is
> used in exactly one place, the login route, to read the user's own user/partner row.


**This portal serves exactly ONE company: `company_id` 1, The Kosher Place (Thailand) Co. Ltd**
(the company of website 3). The Odoo database contains ~20 sibling companies (Jcafe Sukhumvit,
TKP Samui, Chabad entities, Phuket...) that SHARE partners and products. Any query that does not
scope by company silently spans all of them. This caused a real leak: customers saw sibling
companies' invoices on the portal (measured before the fix: 1,174 foreign invoices across 13 of
29 customers; one test account had 8 of its 9 invoices from Jcafe/Samui).

Two layers, deliberately belt-and-braces:

1. **Global.** `callKw` in `src/lib/odoo/client.ts` merges `allowed_company_ids: [COMPANY_ID]`
   into the context of EVERY Odoo call, so Odoo's own multi-company record rules exclude sibling
   records everywhere at once. This is also the ONLY thing that fixes company-dependent PROPERTY
   fields (`res.partner.property_product_pricelist`, `property_account_position_id`), which
   resolve against `env.company` and cannot be constrained by a domain. The merge puts the key
   first so per-call context (`lang`, `location`) is preserved.
2. **Explicit `['company_id','=',COMPANY_ID]` domain terms** on every company-dependent
   transactional query: invoice list/detail/PDF gates, order list, `assertOrderOwnership` (which
   gates BOTH order detail and order PDF), best-sellers ranking, recently-ordered, admin dashboard
   counters, the cron idempotency probe, and the `stock.warehouse` code fallback. Both
   `sale.order` creates (cart + scheduled-orders cron) set `company_id` explicitly rather than
   inheriting the API user's default company.

`COMPANY_ID` comes from `ODOO_COMPANY_ID` (default 1). **Do NOT add `company_id` domain terms to
SHARED models** — `product.template`, `product.product`, `product.packaging`, `product.category`,
`product.public.category`, `product.pricelist(.item)`, `res.partner`, `ir.config_parameter`.
Their `company_id` is usually `false`; filtering on it returns nothing and would empty the
catalog. The global context handles them correctly (false-company records stay visible).

Verified on production before shipping: pricelists and fiscal positions unchanged for all 29
customers (pricing and VAT untouched); portal `res.users` all still visible (login unaffected);
the admin API user has company 1 in `company_ids` (no AccessError). Known accepted consequence:
7 products owned by sibling companies (3 Phuket, 4 Jcafe desserts, SKUs RCP-0428..0431,
DRY-1952/1953, JDC-1533) leave the catalog. To restore any of them, set their company to
The Kosher Place Thailand or blank in Odoo.

## Order attribution (who placed a portal order)
Every portal order is created by the single "Odoo API" account (apps@kosher-place.com,
uid 688), so `create_uid` identifies the CHANNEL but never the person. On confirm, the
checkout route posts an internal log note to the order chatter naming the portal login
(`message_post`, `subtype_xmlid: 'mail.mt_note'`). That subtype is `internal=true`, so the
note is staff-only and is never emailed to the customer or their followers. The post is
best-effort and wrapped in try/catch: the order is already confirmed by then, so a chatter
failure must never surface as a failed checkout.

Related: the Salesperson (`user_id`) column is EMPTY on portal orders (9 of 9, vs 1%
elsewhere) because `website.salesperson_id` is not set on website 3 and `website_sale` uses
that field rather than falling back to the creating user. Fix is Odoo config (set a
salesperson on website 3), not code.

## Known issues / follow-ups
- **ON HOLD (domain change pending): Odoo automation rules for instant cache invalidation.**
  Fully specced in `docs/odoo-cache-invalidation-automation.md`. Deferred because the
  webhook URL hardcodes the portal domain. Nothing is broken meanwhile: stock changes
  already reflect in ~1 min via the freshness overlay, admin-panel edits bust caches
  immediately, and only direct Odoo-backend edits (unpublish/archive/`sale_ok`) wait out
  the ~5 min TTL. Revisit once the final domain is live.
- PDF download: `ir.attachment` + `render_qweb_pdf` fallback. Confirmed working end-to-end on production SaaS (order + invoice PDFs verified 2026-07-21).
- Product list cache is now shared across instances via `unstable_cache` (Data Cache). No explicit pre-warm — the first request per key warms it; add a cron hitting common categories if cold-start latency on rarely-hit keys matters.
- Production Odoo should be in Singapore (Odoo.sh `asia-southeast1`) to cut ~250ms EU round trip.
- `findCart` only picks up portal carts ≤7 days old (prevents stale quotation reuse).
- Hebrew product search depends on Odoo translation data being populated for `product.template.name`. Missing translations = no Hebrew results for that product.
- **LAUNCHED cutover 2026-07-15:** production Vercel now points at PRODUCTION Odoo
  (`https://thekosherplace.odoo.com`, `ODOO_ADMIN_LOGIN=apps@kosher-place.com`). Verified live:
  auth OK, website 3 present, 2,324 published products, New Arrivals non-empty (7). After any
  future Odoo DB switch, re-run the New Arrivals sanity check (see the new-arrivals note above).
- **Cost-field exposure (accepted for now):** portal users can read `standard_price` (cost) on
  products via Odoo's API. Owner accepted the risk for the ~50 known customers; the fix (a small
  Odoo.sh addon restricting the field to internal users) is deferred. Revisit before wider access.
- Session revocation only covers the app path + 4h TTL, not direct-API calls with a valid cookie
  (would need the `isUidActive` check on the ~20 data routes).
