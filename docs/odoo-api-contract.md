# Odoo API Contract (Standard JSON-RPC)

All calls go to `POST /web/dataset/call_kw` unless noted.

## Base Request Shape

```json
{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "model": "<model>",
    "method": "<method>",
    "args": [],
    "kwargs": {}
  }
}
```

All calls from the Next.js BFF include the `Cookie: session_id=<odoo_session>` header.

---

## Authentication

### Login
```
POST /web/session/authenticate
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "db": "<ODOO_DB>",
    "login": "<email>",
    "password": "<password>"
  }
}
```

**Success response:**
```json
{
  "result": {
    "uid": 42,
    "name": "Customer Name",
    "username": "customer@email.com",
    "partner_id": 101,
    "lang": "he_IL",
    "is_system": false
  }
}
```
Response sets `Set-Cookie: session_id=<value>; HttpOnly`. BFF stores this server-side.

**Failure:**
```json
{ "result": { "uid": false } }
```

**Portal user check (after login):**
```json
{
  "model": "res.users",
  "method": "read",
  "args": [[42]],
  "kwargs": { "fields": ["share", "active", "partner_id"] }
}
```
`share = true` → portal user. `share = false` → internal user → reject login.

### Logout
```
POST /web/session/destroy
```

---

## Customer Profile

### Get partner
```json
{
  "model": "res.partner",
  "method": "read",
  "args": [[<partner_id>]],
  "kwargs": {
    "fields": [
      "id", "name", "email", "lang", "active",
      "customer_rank", "property_product_pricelist",
      "commercial_partner_id", "is_company"
    ]
  }
}
```

### Get delivery addresses
```json
{
  "model": "res.partner",
  "method": "search_read",
  "args": [[
    ["parent_id", "=", <commercial_partner_id>],
    ["type", "=", "delivery"],
    ["active", "=", true]
  ]],
  "kwargs": {
    "fields": ["id", "name", "street", "street2", "city", "zip", "country_id", "state_id", "type"]
  }
}
```

---

## Categories

```json
{
  "model": "product.public.category",
  "method": "search_read",
  "args": [[
    ["website_id", "in", [false, <website_id>]],
    ["parent_id", "=", false]
  ]],
  "kwargs": {
    "fields": ["id", "name", "parent_id", "child_id", "sequence", "image_1920"],
    "context": { "lang": "<lang_code>" }
  }
}
```

> **Open question:** Does `product.public.category` have custom visibility fields per partner? Confirm after Phase 0.

---

## Products

### List (paginated)
```json
{
  "model": "product.template",
  "method": "search_read",
  "args": [[
    ["active", "=", true],
    ["sale_ok", "=", true],
    ["website_published", "=", true],
    ["website_id", "in", [false, <website_id>]],
    ["public_categ_ids", "child_of", <category_id>],
    "|",
      ["detailed_type", "!=", "product"],
      "|",
        ["qty_available", ">", 0],
        ["allow_out_of_stock_order", "=", true]
    // + custom Studio visibility domain (TBD after Phase 0)
  ]],
  "kwargs": {
    "fields": [
      "id", "name", "description_sale", "default_code",
      "public_categ_ids", "image_512",
      "product_variant_id", "product_variant_ids",
      "uom_id", "packaging_ids",
      "qty_available", "allow_out_of_stock_order",
      "taxes_id", "list_price", "detailed_type"
    ],
    "offset": <page * per_page>,
    "limit": <per_page>,
    "order": "name asc",
    "context": { "lang": "<lang_code>" }
  }
}
```

### Count (for pagination)
```json
{
  "model": "product.template",
  "method": "search_count",
  "args": [<same_domain>],
  "kwargs": {}
}
```

### Single product
```json
{
  "model": "product.template",
  "method": "read",
  "args": [[<id>]],
  "kwargs": {
    "fields": [
      "id", "name", "description_sale", "default_code",
      "public_categ_ids", "image_1920",
      "product_variant_id", "product_variant_ids",
      "uom_id", "packaging_ids",
      "qty_available", "allow_out_of_stock_order",
      "taxes_id", "list_price", "detailed_type"
    ],
    "context": { "lang": "<lang_code>" }
  }
}
```

---

## Packaging

```json
{
  "model": "product.packaging",
  "method": "search_read",
  "args": [[
    ["product_id", "in", <variant_ids>],
    ["sales", "=", true]
  ]],
  "kwargs": {
    "fields": ["id", "name", "qty", "product_id", "sequence", "barcode"],
    "order": "sequence asc"
  }
}
```

---

## Pricing

> ⚠️ `_get_product_price` is a private method. Access depends on Odoo ACL for the portal user's session. Test in staging. If blocked, fall back to `list_price` (base price, no pricelist applied).

```json
{
  "model": "product.pricelist",
  "method": "execute_kw",
  "args": ["product.pricelist", <pricelist_id>, "_get_product_price", [<product_product_id>, <qty>]],
  "kwargs": {
    "uom_id": <uom_id>,
    "date": false
  }
}
```

Returns: `float` (price in pricelist currency, excluding tax)

**Tax computation:**
```json
{
  "model": "account.tax",
  "method": "compute_all",
  "args": [<price_unit>, null, <qty>, <product_id>, <partner_id>],
  "kwargs": {}
}
```
Returns: `{ total_excluded, total_included, taxes: [{ name, amount }] }`

> **Open question:** Does the portal user session have permission to call `product.pricelist.execute_kw`? Must test in staging. If not: need a minimal custom Odoo endpoint only for pricing, or use `list_price` + client-side tax display as a fallback.

---

## Search

```json
{
  "model": "product.template",
  "method": "search_read",
  "args": [[
    ["active", "=", true],
    ["sale_ok", "=", true],
    ["website_published", "=", true],
    "|", "|",
      ["name", "ilike", "<query>"],
      ["default_code", "ilike", "<query>"],
      ["description_sale", "ilike", "<query>"]
    // + visibility + sellability domain
  ]],
  "kwargs": {
    "fields": ["id", "name", "default_code", "image_512", "packaging_ids", "list_price"],
    "limit": 20,
    "context": { "lang": "<lang_code>" }
  }
}
```

> **Open question:** Hebrew `ilike` search depends on PostgreSQL locale settings and `unaccent`. Confirm your Odoo.sh DB collation supports Hebrew full-text matching.

---

## Cart (sale.order)

### Get active cart
```json
{
  "model": "sale.order",
  "method": "search_read",
  "args": [[
    ["partner_id", "child_of", <commercial_partner_id>],
    ["state", "=", "draft"],
    ["website_id", "=", <portal_website_id>]
  ]],
  "kwargs": {
    "fields": [
      "id", "name", "state", "partner_id", "partner_shipping_id",
      "pricelist_id", "order_line", "amount_untaxed", "amount_tax",
      "amount_total", "currency_id", "note", "date_order"
    ],
    "order": "date_order desc",
    "limit": 1
  }
}
```

### Create cart
```json
{
  "model": "sale.order",
  "method": "create",
  "args": [{
    "partner_id": <commercial_partner_id>,
    "partner_invoice_id": <commercial_partner_id>,
    "partner_shipping_id": <commercial_partner_id>,
    "pricelist_id": <pricelist_id>,
    "website_id": <portal_website_id>
  }],
  "kwargs": {}
}
```
Returns: `<new_order_id>`

### Read order lines
```json
{
  "model": "sale.order.line",
  "method": "search_read",
  "args": [[["order_id", "=", <order_id>]]],
  "kwargs": {
    "fields": [
      "id", "product_id", "product_uom_qty", "product_uom",
      "product_packaging_id", "product_packaging_qty",
      "price_unit", "tax_id", "price_subtotal", "price_total", "name"
    ]
  }
}
```

### Add line
```json
{
  "model": "sale.order.line",
  "method": "create",
  "args": [{
    "order_id": <order_id>,
    "product_id": <product_product_id>,
    "product_packaging_id": <packaging_id>,
    "product_packaging_qty": <pkg_qty>
  }],
  "kwargs": {}
}
```

### Update line quantity
```json
{
  "model": "sale.order.line",
  "method": "write",
  "args": [[<line_id>], { "product_packaging_qty": <new_qty> }],
  "kwargs": {}
}
```

### Remove line
```json
{
  "model": "sale.order.line",
  "method": "unlink",
  "args": [[<line_id>]],
  "kwargs": {}
}
```

### Set delivery address
```json
{
  "model": "sale.order",
  "method": "write",
  "args": [[<order_id>], { "partner_shipping_id": <delivery_partner_id> }],
  "kwargs": {}
}
```

### Set order note
```json
{
  "model": "sale.order",
  "method": "write",
  "args": [[<order_id>], { "note": "<text>" }],
  "kwargs": {}
}
```

### Cancel cart
```json
{
  "model": "sale.order",
  "method": "action_cancel",
  "args": [[<order_id>]],
  "kwargs": {}
}
```

---

## Checkout

### Confirm order
```json
{
  "model": "sale.order",
  "method": "execute_kw",
  "args": ["sale.order", <order_id>, "action_confirm", []],
  "kwargs": {}
}
```

After this call: `sale.order.state = 'sale'`. Odoo automatically:
- Assigns order name (e.g., `S00123`)
- Creates stock pickings
- Sends confirmation email via `sale.email_template_edi_sale`

**Idempotency check before calling:**
Read `sale.order.state` first. If already `'sale'` → return order data without re-confirming.

---

## Order History

### List
```json
{
  "model": "sale.order",
  "method": "search_read",
  "args": [[
    ["partner_id", "child_of", <commercial_partner_id>],
    ["state", "in", ["sale", "done"]],
    ["website_id", "=", <portal_website_id>]
  ]],
  "kwargs": {
    "fields": [
      "id", "name", "date_order", "amount_total",
      "currency_id", "state", "partner_shipping_id"
    ],
    "order": "date_order desc",
    "offset": <offset>,
    "limit": <limit>
  }
}
```

### Detail + lines
Read `sale.order` by ID, then `sale.order.line` filtered by `order_id`. Always validate `partner_id.commercial_partner_id == current_partner.commercial_partner_id` before returning.

### PDF
```
GET /report/pdf/sale.report_saleorder/<order_id>
Cookie: session_id=<odoo_session>
```
Returns PDF binary. BFF proxies this to the browser as `Content-Type: application/pdf`.

---

## Recently Ordered

```json
{
  "model": "sale.order.line",
  "method": "search_read",
  "args": [[
    ["order_id.partner_id", "child_of", <commercial_partner_id>],
    ["order_id.state", "in", ["sale", "done"]],
    ["order_id.website_id", "=", <portal_website_id>]
  ]],
  "kwargs": {
    "fields": ["product_id", "product_packaging_id", "product_packaging_qty", "order_id"],
    "order": "order_id.date_order desc",
    "limit": 50
  }
}
```
BFF deduplicates by `product_id`, returns up to 20 unique products.
