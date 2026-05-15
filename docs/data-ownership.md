# Data Ownership

## Rule: Odoo is the source of truth for all business data.
## Rule: Supabase stores only website-layer data with no business logic.
## Rule: Next.js stores nothing persistently — it is a stateless proxy.

---

## Odoo owns

| Data | Model | Notes |
|---|---|---|
| Portal users | `res.users` | Login, password, active status |
| Customer profile | `res.partner` | Name, email, language, pricelist |
| Delivery addresses | `res.partner` (type=delivery) | Child contacts |
| Pricelist | `product.pricelist` | Per-customer pricing rules |
| Products | `product.template` / `product.product` | Names (EN + HE via translations), SKU, images |
| Ecommerce categories | `product.public.category` | Hierarchy, names |
| Product packaging | `product.packaging` | Name, qty per pack |
| Stock / sellability | `product.product.qty_available` | Live check only |
| Cart | `sale.order` (state=draft) | One per customer, in Odoo |
| Cart lines | `sale.order.line` | Including packaging, packaging_qty |
| Order totals | `sale.order` (computed) | Never computed on website |
| Confirmed orders | `sale.order` (state=sale/done) | |
| Sales order PDF | Odoo report engine | Official document |
| Order emails | Odoo mail system | Sent by Odoo, not by website |
| Delivery / invoices | `stock.picking`, `account.move` | Post-order, Odoo managed |

## Supabase owns

| Data | Table | Schema |
|---|---|---|
| Favorites | `favorites` | `(partner_id bigint, template_id bigint, created_at timestamptz)` |
| Admin users | `admin_users` (Supabase Auth) | Email + password auth |
| Website settings | `settings` | `(key text, value jsonb, updated_at timestamptz)` |
| Website content | `content` | `(slug text, content_en text, content_he text, updated_at timestamptz)` |
| API health log | `health_log` | `(ts timestamptz, endpoint text, status int, latency_ms int)` |
| Audit log | `audit_log` | `(ts timestamptz, actor text, action text, resource text, meta jsonb)` |
| Portal event log | `portal_log` | `(ts timestamptz, partner_id bigint, event text, meta jsonb)` |

## Cookie owns (per browser session)

| Data | Cookie | TTL |
|---|---|---|
| Odoo session proxy | `session` (iron-session, HTTP-only) | 8 hours idle |
| Language preference | `lang` (plain, readable) | 1 year |

## Next.js owns (in-memory, not persisted)

| Data | Where | Notes |
|---|---|---|
| Cart UI state (debounce) | Zustand store | Lost on page refresh — always re-fetches from Odoo |
| Auth state (user object) | Zustand store | Hydrated from GET /api/auth/me on mount |

---

## Supabase Schema (DDL)

```sql
-- Favorites
create table favorites (
  partner_id  bigint not null,
  template_id bigint not null,
  created_at  timestamptz default now(),
  primary key (partner_id, template_id)
);

-- Settings
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- Content (for admin-editable text blocks)
create table content (
  slug       text primary key,
  content_en text not null default '',
  content_he text not null default '',
  updated_at timestamptz default now()
);

-- Health log
create table health_log (
  id         bigserial primary key,
  ts         timestamptz default now(),
  endpoint   text not null,
  status     int not null,
  latency_ms int not null
);

-- Audit log
create table audit_log (
  id       bigserial primary key,
  ts       timestamptz default now(),
  actor    text not null,          -- email or 'system'
  action   text not null,          -- 'login', 'order.confirm', 'cart.clear'
  resource text,                   -- 'order:S00123', 'product:42'
  meta     jsonb default '{}'
);

-- Portal event log
create table portal_log (
  id         bigserial primary key,
  ts         timestamptz default now(),
  partner_id bigint,
  event      text not null,
  meta       jsonb default '{}'
);
```

---

## What the website must never do

- Compute prices (even estimated). Always fetch from Odoo.
- Store cart state in Supabase or cookies. Cart lives in Odoo.
- Send order confirmation emails. Odoo does this.
- Cache product visibility or pricelist rules. Always re-fetch.
- Modify stock quantities. Read-only.
- Accept price inputs from the browser. Prices are read from Odoo cart totals.
