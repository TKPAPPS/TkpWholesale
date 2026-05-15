# Security Rules

## Authentication

### Customer login
1. Credentials sent from browser to `POST /api/auth/login` over HTTPS.
2. Next.js BFF forwards to Odoo `/web/session/authenticate`.
3. On success: Odoo `session_id` stored inside iron-session encrypted cookie (`session` cookie).
4. The browser receives only the iron-session cookie (HTTP-only, Secure, SameSite=Lax).
5. Odoo credentials and session_id are never visible to the browser or JavaScript.
6. Every subsequent API route reads the iron-session → extracts Odoo session_id + partner_id.

### Session expiry
- iron-session cookie TTL: 8 hours (absolute). After expiry, user must re-login.
- On any Odoo call returning `session expired` or `session not found`: return `401` to browser → client redirects to `/login`.
- Do not silently re-authenticate. Always require explicit re-login.

### Admin login
- Supabase Auth (email + password).
- Admin pages under `/admin/*` are protected by Supabase session middleware.
- Admin users have no Odoo session and cannot call Odoo data routes.

---

## Authorization

### Customer routes
Every `/api/*` route (except `/api/auth/*` and `/api/images/*`):
1. Reads iron-session cookie.
2. Extracts `partner_id` and `commercial_partner_id` from session.
3. All Odoo queries are scoped to `partner_id.commercial_partner_id`.
4. Any response that could contain another customer's data is explicitly blocked.

### Product visibility enforcement
The Next.js BFF must include the custom visibility domain (Studio fields) in every `product.template` domain filter. This is because Odoo's standard ACL does not enforce Studio visibility fields automatically.

> ⚠️ Open question: Until Studio field names are confirmed (see audit Phase 0), the visibility domain is incomplete. Mark clearly in code with `// TODO: add Studio visibility domain`.

If a customer requests `GET /api/products/{id}` for a product that should be hidden from them:
- Return `404` — not `403`. Do not reveal product existence.

### Cart ownership
- Never look up a cart by `order_id` alone.
- Always filter: `partner_id.commercial_partner_id == session.commercial_partner_id` AND `website_id == portal_website_id`.
- Cart line operations: first verify the line's `order_id` belongs to the current customer's cart.

### Order ownership
- Never return an order by ID without verifying: `order.partner_id.commercial_partner_id == session.commercial_partner_id`.
- Return `403` for access violations (safe to reveal existence for own orders).

### PDF ownership
- Same check as order ownership before proxying PDF.

### Delivery address ownership
- Only return addresses where `parent_id == commercial_partner_id`.
- Validate selected `delivery_address_id` belongs to customer before writing to cart.

---

## Input Validation

| Input | Validation |
|---|---|
| `packaging_qty` | Must be positive integer. Reject `<= 0` and non-integer. |
| `product_id` | Must exist and be visible/sellable for this customer. |
| `packaging_id` | Must belong to `product_id` and have `sales = true`. |
| `delivery_address_id` | Must belong to customer's commercial partner. |
| `note` | Strip HTML, max 500 chars. |
| `search query` | Max 100 chars. Strip leading/trailing whitespace. |
| `order ID in URL` | Must be integer. Return 404 for non-integer. |
| `line ID in URL` | Same. |

---

## Rate Limiting

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` | 5 attempts per IP per 15 minutes |
| `POST /api/checkout/confirm` | 3 per customer per minute |
| All other routes | 60 per minute per customer |

Implementation: use Vercel Edge middleware + in-memory counter, or Supabase as rate-limit store.

> Open question: Vercel free tier has no built-in rate limiting. Evaluate Upstash Redis for rate limiting.

---

## Transport Security

- All traffic over HTTPS (Vercel enforces this by default).
- Odoo.sh → Vercel calls are HTTPS (Odoo.sh provides HTTPS by default).
- Do not allow HTTP on any route.

---

## Secrets

- `SESSION_SECRET` (iron-session): minimum 32 random characters. Never commit to git.
- `SUPABASE_SERVICE_ROLE_KEY`: server-side only. Never exposed to client bundles.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser-safe (RLS enforced in Supabase).
- Odoo session_id: stored only in iron-session encrypted cookie. Never in a log.

---

## Logging

Never log:
- Passwords
- Odoo session_id values
- Full customer order notes (may contain personal data)

Always log to Supabase `audit_log`:
- Login events (success and failure) with IP and timestamp
- Checkout confirm (success and failure)
- Cart clear
- PDF download

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Customer session expired mid-checkout | Return 401 → client shows "session expired, please log in again" modal with cart preserved (re-fetched after login) |
| Odoo down during checkout confirm | Return 503 → show OdooUnavailable state. Do not mark order as confirmed. |
| Concurrent checkout confirm | Second call finds `state = 'sale'` → return `{ already_confirmed: true }` with order data |
| Cart line for now-invisible product | Warn on GET /api/cart. Block on POST /api/checkout/confirm. |
| Cart line for out-of-stock product | Same: warn on fetch, block on confirm. |
| Customer changes delivery address to another customer's address | Rejected at validation — address not in customer's delivery address list |
