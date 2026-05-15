# Testing Plan

## Phase 1: Mock API (skeleton)
All tests run against mock data. No real Odoo required.

### Manual smoke test checklist

**Auth flow**
- [ ] Login with mock credentials → redirects to /products
- [ ] Login with wrong password → shows error, stays on /login
- [ ] Direct access to /products without login → redirects to /login
- [ ] Logout → redirects to / (landing page)
- [ ] Session expiry → shows expired message, redirects to /login

**Language / RTL**
- [ ] Switch to Hebrew → page direction becomes RTL
- [ ] Switch back to English → LTR restored
- [ ] Hebrew product names display correctly in product cards
- [ ] Hebrew search returns results
- [ ] RTL layout in cart, checkout, order pages

**Product listing**
- [ ] Products page loads with sidebar categories
- [ ] Clicking a category filters products
- [ ] Pagination works (prev/next, page numbers)
- [ ] Sort by name, price, recently ordered changes order
- [ ] Search by English term returns results
- [ ] Search by Hebrew term returns results
- [ ] Search by SKU returns results
- [ ] Empty search shows empty state
- [ ] Loading state appears before products load

**Product detail**
- [ ] Product detail page loads for a valid ID
- [ ] Invalid product ID shows 404 error state
- [ ] Packaging options display with prices
- [ ] Quantity selector works (increment/decrement/type)
- [ ] Add to cart button adds to cart and shows confirmation

**Favorites**
- [ ] Favorite button on product card toggles on/off
- [ ] /favorites page shows favorited products
- [ ] Unfavorite from favorites page removes it
- [ ] Empty favorites page shows empty state

**Recently ordered**
- [ ] /recently-ordered shows recent products
- [ ] Recently ordered section on products page shows shortcuts

**Cart**
- [ ] Cart page shows all lines
- [ ] Quantity change updates line totals
- [ ] Remove line works
- [ ] Empty cart shows empty state with link to products
- [ ] Cart totals (subtotal, tax, total) are displayed
- [ ] Odoo unavailable banner shows (mock 503)

**Checkout**
- [ ] Checkout review shows all lines
- [ ] Delivery address selector shows options
- [ ] Order note field accepts text
- [ ] Confirm order → redirects to order confirmation
- [ ] Empty cart blocked from checkout
- [ ] Odoo unavailable → shows unavailable state

**Order confirmation**
- [ ] Shows order number, date, lines, total
- [ ] "Continue ordering" link returns to products

**Order history**
- [ ] List shows orders sorted by date
- [ ] Search by order number filters
- [ ] Date range filter works
- [ ] Pagination works

**Order detail**
- [ ] Shows all order fields
- [ ] "Download PDF" button shows placeholder
- [ ] "Reorder" button navigates to reorder preview

**Admin**
- [ ] /admin/login with mock admin credentials
- [ ] /admin dashboard loads
- [ ] /admin/health shows API status
- [ ] /admin/logs shows recent logs
- [ ] /admin/audit shows audit trail
- [ ] Direct access to /admin without admin login → redirects

---

## Phase 2: Odoo Integration (after real API connected)

### Odoo connectivity
- [ ] Login with real portal user credentials
- [ ] Login with real password wrong → correct error
- [ ] Login with internal user → NOT_PORTAL_USER error
- [ ] Session stored correctly server-side

### Products & pricing
- [ ] Product list loads from real Odoo
- [ ] Hebrew names display (confirm he_IL translation exists)
- [ ] Pricelist pricing is applied correctly (compare with Odoo UI)
- [ ] Packaging options match Odoo product.packaging records
- [ ] Out-of-stock product hidden (allow_out_of_stock_order = false)
- [ ] Out-of-stock product shown (allow_out_of_stock_order = true)
- [ ] Per-customer visibility: product hidden for customer A is visible for customer B
- [ ] Hidden product URL returns 404

### Cart & orders
- [ ] Cart creates a real sale.order in Odoo
- [ ] Line added → sale.order.line created in Odoo
- [ ] Quantity change → Odoo line updated, product_uom_qty recomputed
- [ ] Cart totals match Odoo sale.order.amount_total exactly
- [ ] Confirm → sale.order.state = 'sale' in Odoo
- [ ] Confirm → Odoo sends email automatically
- [ ] Confirm → PDF available from Odoo
- [ ] Double confirm → returns already_confirmed (idempotency)

### Performance benchmarks
- [ ] Product list (24 items with prices): < 800ms
- [ ] Cart get: < 400ms
- [ ] Cart line update: < 600ms
- [ ] Search: < 600ms

---

## Open Questions Before Integration Testing

1. Can portal user session call `product.pricelist._get_product_price`? (must test)
2. Does `product.public.category` have custom visibility fields? (must inspect)
3. What are the exact Studio visibility field names on `product.template`? (must inspect)
4. Does `allow_out_of_stock_order` field name match exactly? (must inspect)
5. Is there a dedicated `website` record for the portal? (must configure)
6. Does Hebrew `ilike` search work on this DB collation? (must test)
