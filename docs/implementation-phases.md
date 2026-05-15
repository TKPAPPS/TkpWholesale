# Implementation Phases

## Phase 1 — Skeleton with Mock API (current)
**Goal:** Full UI working end-to-end with mock data. No real Odoo connection.

**Deliverables:**
- All pages built and navigable
- Mock API layer returns realistic data
- RTL / EN-HE language switching
- Loading, empty, error states everywhere
- Admin stub pages

**Done when:** Every item in testing-plan.md Phase 1 checklist passes.

---

## Phase 2 — Odoo Connection (standard API)
**Goal:** Real Odoo data, real auth, real cart and orders.

**Steps:**
1. Set `USE_MOCK_API=false` in env
2. Implement real Odoo JSON-RPC client (`src/lib/odoo/client.ts`)
3. Implement iron-session auth (login, logout, me endpoints)
4. Connect products + categories endpoints
5. Connect search endpoint
6. Connect cart endpoints (get, add line, update line, remove line, clear)
7. Connect checkout confirm
8. Connect order history + detail
9. Connect PDF proxy
10. Connect recently-ordered
11. Run Phase 2 test checklist

**Risk:** `_get_product_price` may not be callable by portal user session. If blocked:
- Option A: Use `list_price` as fallback + display "price may vary" note
- Option B: Add a single minimal custom Odoo endpoint only for pricing

---

## Phase 3 — Visibility + Sellability
**Goal:** Real per-customer product hiding enforced.

**Prerequisite:** Studio field names confirmed (Odoo Phase 0 audit).

**Steps:**
1. Update `buildVisibilityDomain(partner)` in `src/lib/odoo/domains.ts`
2. Apply domain to all product queries (list, search, detail, recently-ordered, favorites revalidation, cart validation, reorder preview)
3. Run visibility tests for multiple customers
4. Verify hidden product URL returns 404

---

## Phase 4 — Favorites (Supabase)
**Goal:** Real favorites stored in Supabase, validated against Odoo visibility.

**Steps:**
1. Set up Supabase project and schema (see data-ownership.md DDL)
2. Implement favorites read (validates each against current Odoo visibility)
3. Implement add/remove favorites
4. Show favorite count in navbar

---

## Phase 5 — Admin Panel
**Goal:** Admin pages connected to real Supabase data.

**Steps:**
1. Supabase Auth for admin users
2. Settings CRUD
3. Content CRUD (editable text blocks with EN/HE)
4. API health monitor (cron: ping Odoo, store in health_log)
5. Audit log display
6. Portal event log display

---

## Phase 6 — Hardening
**Goal:** Production-ready.

**Steps:**
1. Rate limiting on auth and checkout endpoints
2. Proper error logging (Supabase audit_log)
3. Session expiry handling and re-login flow
4. Performance: cache category tree (5min), product count (1min)
5. Image CDN caching via Vercel
6. Security audit: IDOR tests, visibility bypass tests
7. Mobile browser testing

---

## Phase 7 — Custom Odoo Module (if needed)
**Goal:** Add a minimal Odoo module only for capabilities the standard API cannot provide.

**Candidates:**
- Pricelist pricing endpoint (if portal user ACL blocks `_get_product_price`)
- Visibility domain computation (if Studio field structure is too complex for client-side domain building)
- Abandoned cart cleanup scheduled action

This is optional — only implemented if Phase 2/3 testing reveals blockers.
