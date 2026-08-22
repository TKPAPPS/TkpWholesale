# Portal QA: use cases and edge cases

The checklist `run.mjs` executes. Grouped by what a customer actually does, then by the
failure modes that have really occurred in this codebase.

Every case is marked:

- **AUTO** covered by `run.mjs` (read-only, safe against production)
- **LOCAL** covered by the local mock-mode suite (`run.mjs --local`), which exercises input
  validation without touching Odoo
- **MANUAL** needs a human or a write-capable staging Odoo

## Why group A exists

Two customer-visible bugs in two days had one shared cause: **the same `ProductCard` was fed
by two different payload builders.** `/api/products` resolved the pricelist and sent
`allow_out_of_stock_order`; `/api/search` hand-rolled a lighter payload that did neither. The
result was a product whose Add button worked from the grid but was greyed from search, and a
price on the card that was not the customer's price.

So group A is not a nice-to-have. It is the regression test for the class of bug that
actually damages trust: two surfaces that look identical and disagree.

---

## A. Payload parity (highest value)

| # | Case | Cover |
|---|---|---|
| A1 | Every field `ProductCard` reads is identical between `/api/products` and `/api/search` for the same product and customer | AUTO |
| A2 | Packaging options (id, name, qty, pack price, unit price, default flag) identical grid vs search | AUTO |
| A3 | Product detail `/api/products/[id]` agrees with the grid on price and stock flags | AUTO |
| A4 | Featured, best sellers, recently ordered, favorites all agree with the grid | AUTO |
| A5 | `SearchHit` remains assignable to `Product` so the compiler catches divergence | AUTO (tsc) |

## B. Pricing

| # | Case | Cover |
|---|---|---|
| B1 | Card price reflects the customer's pricelist, not `list_price` | AUTO |
| B2 | Two customers on different pricelists see different prices for the same product | AUTO |
| B3 | Pack price equals unit price x pack qty (within rounding) | AUTO |
| B4 | A fixed-price pricelist rule is applied exactly (BAK-0225 on the wholesale list) | AUTO |
| B5 | NO-VAT fiscal position customers see the ex-VAT price | AUTO |
| B6 | Card price matches what Odoo charges in the cart | MANUAL (needs a write) |
| B7 | Prices never render as `NaN`, `null`, negative, or zero on a sellable product | AUTO |

## C. Stock and availability

| # | Case | Cover |
|---|---|---|
| C1 | `allow_out_of_stock_order` products are orderable regardless of stock (no cap) | AUTO |
| C2 | ...and are always visible, including at zero stock | AUTO |
| C3 | ...and their Add button is enabled on every surface | AUTO |
| C4 | Weight (kg) products with fractional stock below one pack are not shown sold out | AUTO |
| C5 | `in_stock` agrees with R4-scoped quantity, not the global `qty_available` | AUTO |
| C6 | Non-storable consumables count as always in stock | AUTO |
| C7 | Quantity cap clamps rather than rejects | LOCAL |
| C8 | Stock drop between cart-add and checkout is caught | MANUAL |

## D. Visibility and access control

| # | Case | Cover |
|---|---|---|
| D1 | Unpublished products never appear | AUTO |
| D2 | Admin-hidden products never appear | AUTO |
| D3 | Per-customer hidden products never appear, and 404 by direct URL | AUTO |
| D4 | `sale_ok = false` products never appear | AUTO |
| D5 | Sibling-company products never appear (company 1 only) | AUTO |
| D6 | Hidden category hides the whole subtree | AUTO |

## E. Authentication and isolation

| # | Case | Cover |
|---|---|---|
| E1 | No cookie returns 401 on every customer route | AUTO |
| E2 | Garbage and forged-signature cookies return 401 | AUTO |
| E3 | Expired cookie returns 401 | AUTO |
| E4 | Customer A cannot read B's order, invoice, or either PDF | AUTO |
| E5 | Sequential id scanning leaks nothing | AUTO |
| E6 | Customer A cannot reorder B's order | AUTO |
| E7 | Admin routes reject a customer session | AUTO |

## F. Input validation

| # | Case | Cover |
|---|---|---|
| F1 | Malformed, empty and `null` request bodies never 500 | LOCAL |
| F2 | Pagination: negative, zero, NaN, fractional, oversized | LOCAL |
| F3 | Dates: calendar-invalid (`2025-02-30`) rejected everywhere | LOCAL |
| F4 | Search: wildcards, SQL-ish input, over-length, emoji, Hebrew | AUTO |
| F5 | Checkout: address id, note length, PO ref, delivery date, schedule | LOCAL |
| F6 | A schedule that can never run is rejected before the order is placed | LOCAL |

## G. Internationalisation

| # | Case | Cover |
|---|---|---|
| G1 | Hebrew names are returned and differ from English where translated | AUTO |
| G2 | No user-visible string falls back to a raw translation key | AUTO |
| G3 | RTL layout mirrors correctly | MANUAL |
| G4 | Money always renders LTR in Hebrew | MANUAL |

## H. Documents

| # | Case | Cover |
|---|---|---|
| H1 | Order PDF renders for a real order without throwing | AUTO |
| H2 | Non-Latin text folds or drops without corrupting the document | AUTO |
| H3 | Ship-to lines gutted by stripping are omitted, intact short ones kept | AUTO |
| H4 | Invoice PDF is fetched from Odoo and is a valid PDF | AUTO |

## Not covered without a write-capable staging Odoo

Cart add/update/remove, full checkout, inter-company PO creation, the webhook confirm
fallback, scheduled-order execution, and the 15-concurrent load test. Production is
read-only for testing by policy, and the staging branch was torn down.
