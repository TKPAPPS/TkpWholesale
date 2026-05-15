# Frontend API Contract (Next.js → Browser)

All routes are Next.js API routes. The browser calls these — never Odoo directly.

## Authentication

All protected routes read the iron-session cookie. If missing/invalid: `401`.

---

## Auth

### POST /api/auth/login
**Request:**
```json
{ "login": "user@email.com", "password": "secret" }
```
**Success 200:**
```json
{
  "user": {
    "uid": 42,
    "partner_id": 101,
    "name": "Acme Foods",
    "email": "user@email.com",
    "lang": "he",
    "pricelist_id": 3,
    "pricelist_name": "IL Pricelist THB"
  }
}
```
Sets HTTP-only `session` cookie (iron-session).

**Error 401:**
```json
{ "error": "INVALID_CREDENTIALS", "message": "Invalid email or password." }
```
**Error 403:**
```json
{ "error": "NOT_PORTAL_USER", "message": "Access restricted to portal users." }
```

### POST /api/auth/logout
**Success 200:** `{}` — clears session cookie.

### GET /api/auth/me
**Success 200:**
```json
{
  "uid": 42,
  "partner_id": 101,
  "name": "Acme Foods",
  "email": "user@email.com",
  "lang": "he",
  "pricelist_id": 3
}
```
**Error 401:** Not authenticated.

---

## Categories

### GET /api/categories
**Query params:** `lang=en|he`

**Success 200:**
```json
{
  "categories": [
    {
      "id": 1,
      "name": "Oils & Condiments",
      "name_he": "שמנים ותבלינים",
      "parent_id": null,
      "children": [
        { "id": 4, "name": "Olive Oil", "name_he": "שמן זית", "parent_id": 1, "children": [] }
      ]
    }
  ]
}
```

---

## Products

### GET /api/products
**Query params:** `category_id`, `page` (0-based), `per_page` (default 24), `sort` (`name|price|recently_ordered`), `lang`

**Success 200:**
```json
{
  "products": [
    {
      "id": 10,
      "template_id": 10,
      "variant_id": 22,
      "name": "Extra Virgin Olive Oil 5L",
      "name_he": "שמן זית כתית 5 ליטר",
      "sku": "OIL-EV-5L",
      "image_url": "/api/images/product/10/512",
      "categories": [{ "id": 1, "name": "Oils" }],
      "uom_name": "Bottle",
      "packaging_options": [
        {
          "id": 5,
          "name": "Pack of 4",
          "qty": 4,
          "price_per_pack_excl_tax": 960.00,
          "price_per_pack_incl_tax": 1008.00,
          "price_per_unit_excl_tax": 240.00,
          "price_per_unit_incl_tax": 252.00,
          "is_default": true
        }
      ],
      "currency": "THB",
      "tax_display": "incl_tax",
      "tax_names": ["VAT 5%"],
      "sellable": true,
      "in_stock": true
    }
  ],
  "total": 47,
  "page": 0,
  "per_page": 24
}
```

**Error 401:** Not authenticated.
**Error 503:** `{ "error": "ODOO_UNAVAILABLE" }` — Odoo unreachable.

### GET /api/products/[id]
**Success 200:** Same shape as product object above, plus:
```json
{
  "description": "Cold pressed, first cold extraction...",
  "description_he": "...",
  "all_categories": [...],
  "packaging_options": [...]
}
```
**Error 404:** Product not found or not visible to this customer.
**Error 401:** Not authenticated.

---

## Search

### GET /api/search?q=olive&lang=en
**Success 200:**
```json
{
  "results": [ /* same product shape, limit 20 */ ],
  "query": "olive",
  "total": 3
}
```

---

## Recently Ordered

### GET /api/recently-ordered?lang=en
**Success 200:**
```json
{
  "products": [ /* same product shape, max 20, deduplicated */ ]
}
```

---

## Cart

### GET /api/cart
**Success 200:**
```json
{
  "cart_id": 456,
  "state": "draft",
  "partner_shipping_id": 78,
  "partner_shipping_name": "Warehouse A",
  "note": "",
  "lines": [
    {
      "line_id": 1001,
      "product_id": 22,
      "template_id": 10,
      "product_name": "Extra Virgin Olive Oil 5L",
      "product_name_he": "שמן זית כתית 5 ליטר",
      "product_image_url": "/api/images/product/10/128",
      "sku": "OIL-EV-5L",
      "packaging_id": 5,
      "packaging_name": "Pack of 4",
      "packaging_qty": 2,
      "unit_qty": 8,
      "price_unit": 240.00,
      "price_subtotal": 1920.00,
      "price_total": 2016.00,
      "warnings": []
    }
  ],
  "amount_untaxed": 1920.00,
  "amount_tax": 96.00,
  "amount_total": 2016.00,
  "currency": "THB",
  "warnings": []
}
```
**Error 401:** Not authenticated.
**Error 503:** Odoo unavailable (show OdooUnavailable component).

### POST /api/cart/lines
**Request:**
```json
{
  "product_id": 22,
  "packaging_id": 5,
  "packaging_qty": 2
}
```
**Success 200:** Returns updated full cart object (same as GET /api/cart).
**Error 400:**
```json
{ "error": "PRODUCT_NOT_AVAILABLE", "message": "This product is not available." }
```
```json
{ "error": "OUT_OF_STOCK", "message": "This product is currently out of stock." }
```

### PATCH /api/cart/lines/[lineId]
**Request:**
```json
{ "packaging_qty": 3 }
```
**Success 200:** Returns updated cart.
**Error 400:** `{ "error": "INVALID_QTY" }`

### DELETE /api/cart/lines/[lineId]
**Success 200:** Returns updated cart.

### DELETE /api/cart
**Success 200:** `{ "cleared": true }`
**Error 400:** `{ "error": "CART_ALREADY_CONFIRMED" }`

---

## Checkout

### GET /api/checkout/review
Returns current cart with full validation. Same shape as GET /api/cart, plus:
```json
{
  "valid": true,
  "blocking_errors": [],
  "delivery_addresses": [
    { "id": 78, "name": "Warehouse A", "street": "123 Main St", "city": "Bangkok" }
  ]
}
```
If any line has a warning that blocks checkout: `"valid": false`.

### POST /api/checkout/confirm
**Request:**
```json
{
  "delivery_address_id": 78,
  "note": "Please deliver before noon"
}
```
**Success 200:**
```json
{
  "order_id": 789,
  "order_name": "S00123",
  "state": "sale",
  "amount_total": 2016.00,
  "currency": "THB",
  "already_confirmed": false
}
```
**Error 400:**
```json
{ "error": "CART_EMPTY" }
{ "error": "INVALID_DELIVERY_ADDRESS" }
{ "error": "VALIDATION_FAILED", "invalid_lines": [{ "product_name": "...", "reason": "out_of_stock" }] }
```
**Error 503:** Odoo unavailable.

---

## Orders

### GET /api/orders?page=0&per_page=20&search=S001&date_from=2026-01-01&date_to=2026-05-15
**Success 200:**
```json
{
  "orders": [
    {
      "id": 789,
      "name": "S00123",
      "date_order": "2026-05-10T09:30:00Z",
      "amount_total": 2016.00,
      "currency": "THB",
      "state": "sale",
      "state_label": "Sales Order",
      "line_count": 3
    }
  ],
  "total": 12,
  "page": 0,
  "per_page": 20
}
```

### GET /api/orders/[id]
**Success 200:**
```json
{
  "id": 789,
  "name": "S00123",
  "date_order": "2026-05-10T09:30:00Z",
  "state": "sale",
  "partner_shipping": { "id": 78, "name": "Warehouse A", "street": "..." },
  "note": "Please deliver before noon",
  "lines": [
    {
      "line_id": 1001,
      "product_id": 22,
      "product_name": "Extra Virgin Olive Oil 5L",
      "product_name_he": "שמן זית כתית 5 ליטר",
      "sku": "OIL-EV-5L",
      "packaging_name": "Pack of 4",
      "packaging_qty": 2,
      "unit_qty": 8,
      "price_unit": 240.00,
      "price_subtotal": 1920.00,
      "price_total": 2016.00
    }
  ],
  "amount_untaxed": 1920.00,
  "amount_tax": 96.00,
  "amount_total": 2016.00,
  "currency": "THB"
}
```
**Error 403:** Order does not belong to this customer.
**Error 404:** Order not found.

### GET /api/orders/[id]/pdf
Returns PDF binary stream.
**Headers:** `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="S00123.pdf"`

---

## Favorites

Stored in Supabase, keyed by `(partner_id, product_template_id)`. Odoo visibility/sellability is validated on read.

### GET /api/favorites?lang=en
```json
{
  "favorites": [ /* same product shape, filtered by current visibility */ ]
}
```

### POST /api/favorites
```json
{ "template_id": 10 }
```
Returns `{ "added": true, "template_id": 10 }` or `{ "error": "ALREADY_FAVORITED" }`.

### DELETE /api/favorites/[templateId]
Returns `{ "removed": true }`.

---

## Images

### GET /api/images/product/[id]/[size]
Proxies Odoo `/web/image/product.template/{id}/image_{size}` with the server-side session cookie. Cache-Control: `public, max-age=86400`.

---

## Error Response Shape (all endpoints)

```json
{
  "error": "<ERROR_CODE>",
  "message": "<human readable>",
  "details": {}
}
```
See `docs/error-codes.md` for all codes.
