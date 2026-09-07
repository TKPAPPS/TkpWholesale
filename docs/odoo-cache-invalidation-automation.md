# Odoo automation rules for instant cache invalidation (UNBLOCKED)

**Status: UNBLOCKED as of 2026-09-07.** The domain question that deferred this is settled:
the final customer-facing domain is **`tkp-shop.com`**, attached to the Vercel project with
`www.tkp-shop.com` redirecting to the apex. Use that domain in the webhook URL.

`wholesale.tkpapps.com` is deliberately being kept alive alongside it, so any existing Odoo
webhook still pointing there keeps working — this is not a launch blocker. Repoint it to
`tkp-shop.com` so there is one canonical domain, but it can be done after the cutover.

**Nothing is broken while this is on hold.** The endpoint and the freshness overlay are
already shipped and working; these rules only shorten the reflect-time for one specific
class of edit (see "Why" below).

## Why

Product availability reaches the storefront through three layers:

| Change | How it currently reflects | Delay |
|---|---|---|
| Stock level (sold out / restocked) | Freshness overlay in `fetchOdooProducts` re-resolves every cached page against the live in-stock set | ~1 min, automatic |
| Admin panel edits (hide product/category, featured, settings) | Admin routes call `bustProductCache()` / `bustCategoriesCache()` etc. directly | Immediate, automatic |
| **Edits made directly in the Odoo backend** (unpublish, archive, `sale_ok` off) | **Nothing busts the cache; waits out the TTL** | **up to ~5 min** |

These automation rules close only that third row. They are a nice-to-have, not a
correctness fix: order-time enforcement is fully live regardless
(`getAvailableUnitsForOrdering` at cart-add, `findUnorderableTemplateIdsLive` at checkout),
so an unavailable product can never actually be ordered during the stale window.

**Do NOT add a rule for stock quantity changes.** Stock is already handled by the overlay,
and a stock-triggered rule would fire on every warehouse move across all ~20 companies,
hammering the endpoint for no benefit.

## Prerequisite (already done)

`GET|POST /api/revalidate-products` accepts `?secret=<CRON_SECRET>` as well as
`Authorization: Bearer <CRON_SECRET>`. The query-param form exists specifically because
Odoo's built-in "Send Webhook Notification" action cannot set custom headers.
See `src/app/api/revalidate-products/route.ts`.

## The rules

Odoo: **Settings > Technical > Automation Rules** (developer mode required).
Both rules use the same action:

- Action: **Send Webhook Notification**
- URL: `https://tkp-shop.com/api/revalidate-products?secret=<CRON_SECRET>`

`<CRON_SECRET>` is the value already set in the Vercel project env.

### Rule 1: publish / out-of-stock-flag changes
- Model: `product.website.settings` (Product Website Settings)
- Trigger: **On save**, watching fields **Published** (`is_published`) and
  **Continue Selling if Out of Stock** (`allow_out_of_stock_order`)

### Rule 2: sale / archive changes
- Model: `product.template` (Product)
- Trigger: **On save**, watching fields **Can be Sold** (`sale_ok`) and **Active** (`active`)

### Rule 3 (optional): per-customer hidden products/categories
- Model: `res.partner` (Contact)
- Trigger: **On save**, watching fields `hidden_product_ids` and `hidden_category_ids`
- Only worth adding if per-customer hides need to apply faster than the 5 min
  `odoo-customer-hidden` TTL.

## When the domain changes

The URL is the only thing that needs updating. If the rules are already in place when the
domain changes, edit the URL in each rule; otherwise just use the final domain when
creating them.

Because `wholesale.tkpapps.com` stays attached to the same Vercel project, a rule pointing at
the old host keeps resolving to the same app — so a stale URL degrades to "still works",
never to a broken webhook. Repoint at leisure, then re-run the verify curl below.

## Verifying

After creating a rule, unpublish a test product in Odoo and confirm it disappears from the
storefront listing within seconds instead of minutes. The endpoint returns
`{"ok":true,"revalidated":[...tags]}` on success and `401` if the secret is wrong, so it
can also be checked directly:

```
curl "https://tkp-shop.com/api/revalidate-products?secret=<CRON_SECRET>"
```

## Security note

The endpoint only flushes caches. A leaked secret means someone could clear the cache
(causing a brief extra Odoo read), nothing more. No data is exposed or modified.
