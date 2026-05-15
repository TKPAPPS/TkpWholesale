# System Architecture

## Overview

A private B2B ordering portal built on Next.js (Vercel), using Odoo 18 (Odoo.sh) as the business backend via its standard JSON-RPC API, and Supabase for non-Odoo data (favorites, admin, audit logs).

```
Browser
  │  HTTPS
  ▼
Next.js on Vercel          ← UI + BFF (Backend For Frontend)
  ├── /api/*               ← Server-side API routes (proxy + transform)
  │     ├── Odoo JSON-RPC  ← Odoo session managed server-side
  │     └── Supabase SDK   ← Favorites, admin data
  └── Pages (App Router)   ← SSR/CSR rendering
```

## Stack

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind | Vercel |
| BFF API layer | Next.js API routes | Vercel (serverless) |
| Business backend | Odoo 18 | Odoo.sh |
| Auxiliary data | Supabase (PostgreSQL) | Supabase cloud |
| Auth (customer) | Odoo session via JSON-RPC → iron-session cookie | Server-side |
| Auth (admin) | Supabase Auth | Supabase |

## Key Architectural Decisions

### 1. Next.js as BFF

The browser never calls Odoo directly. All Odoo calls go through Next.js `/api/*` routes running on Vercel serverless functions. This means:
- The Odoo session cookie is stored server-side in an iron-session encrypted cookie.
- Odoo credentials and session are never exposed to the browser.
- The browser authenticates with Next.js; Next.js authenticates with Odoo.

### 2. Standard Odoo JSON-RPC API

We use Odoo's built-in JSON-RPC endpoint (`/web/dataset/call_kw`) for all data access. No custom Odoo module is built in this phase. This means:
- Authentication via `/web/session/authenticate` → `session_id` cookie.
- Portal users log in with their Odoo credentials.
- Data is fetched via `search_read`, `read`, `create`, `write`, `execute_kw`.
- The Next.js BFF is responsible for applying visibility domain filters (Studio fields) that Odoo's standard ACL does not enforce automatically.

> **Open question:** Confirm exact Studio field names for per-customer product visibility (see audit report, Section 3.2). Until confirmed, visibility filtering is incomplete.

### 3. Language / RTL

- Language preference stored in cookie `lang` = `en` | `he`.
- Root layout reads cookie server-side → sets `<html lang dir>` attribute.
- Tailwind `rtl:` variants handle directional styles.
- Odoo API calls use `context: { lang: 'he_IL' | 'en_US' }` for translated field values.
- Language switcher sets cookie and triggers full page reload to apply SSR direction.

### 4. Mock API layer

`USE_MOCK_API=true` in `.env.local` routes all Next.js API calls to local mock data instead of Odoo. Switch to `false` to connect to real Odoo. No code changes needed.

### 5. Data ownership split

| Data | Source | Rationale |
|---|---|---|
| Products, prices, categories | Odoo | Source of truth |
| Cart (draft quotation) | Odoo | Business rule: cart = Odoo sale.order |
| Orders, delivery, invoices | Odoo | Business rule |
| Customer profile, pricelist | Odoo | Source of truth |
| Favorites | Supabase | No Odoo equivalent; fast reads |
| Language preference | Cookie | Stateless; per browser |
| Admin settings, content | Supabase | Website-level config |
| Audit logs | Supabase | Website-level logging |
| API health status | Supabase | Persisted health checks |

## Request Flow — Product Page

```
1. Browser → GET /products
2. Next.js server component reads lang cookie → renders HTML with dir
3. Client fetches GET /api/products?page=1&category=3
4. Next.js API route:
     a. Validates iron-session cookie → gets Odoo session_id + partner_id
     b. Calls Odoo: search_read product.template with visibility + sellability domain
     c. For each product: calls Odoo pricelist._get_product_price
     d. Returns merged JSON
5. Client renders ProductGrid
```

## Request Flow — Checkout Confirm

```
1. Browser → POST /api/checkout/confirm
2. Next.js API route:
     a. Validates session
     b. Fetches current cart (sale.order in draft)
     c. Re-validates all lines (visibility + sellability)
     d. If valid: execute_kw → sale.order.action_confirm()
     e. Odoo: confirms order, sends email, creates delivery
     f. Returns { order_id, order_name, state: 'sale' }
3. Browser redirects to /order-confirmation/{orderId}
```

## Deployment

- **Vercel:** Auto-deploys from main branch. Environment variables set in Vercel dashboard.
- **Odoo.sh:** No changes to Odoo required for standard API phase.
- **Supabase:** Schema migrations via Supabase CLI.

## Environment Variables

See `.env.local.example` for the full list.
