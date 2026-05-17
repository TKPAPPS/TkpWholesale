# Odoo Customer-Specific Product/Category Visibility — Investigation Required

**Status: UNRESOLVED — LAUNCH BLOCKER**

The portal currently shows the same product catalogue to all logged-in customers.
The specification requires that individual customers can be restricted to specific products
and/or categories. This cannot be implemented without knowing the exact Odoo field or model
in use on your Odoo 18 instance.

**The portal must not be used with real customers until this is resolved.**

---

## What needs to be determined

The portal needs to know: for a given `res.partner` (customer), which product templates and/or
which `product.public.category` records are they allowed to see?

Specifically, the implementation needs:

1. The **model name** where restrictions are stored (e.g., `product.template`, `res.partner`, a custom model)
2. The **field name** on that model (e.g., `x_allowed_partner_ids`, `website_published_category_ids`)
3. The **direction** of the relationship:
   - Option A: field on partner → "this partner can see these products"
   - Option B: field on product → "this product is visible to these partners"
4. Whether restrictions apply at the **product** level, the **category** level, or both

---

## Where to check in Odoo

### 1. Check res.partner for custom fields
Go to: **Settings → Technical → Database Structure → Models → res.partner**
Look for any field with the `x_` prefix or any field referencing `product.template` or `product.public.category`.

Also check directly on a partner record:
**Contacts → [open any customer] → (Developer mode) inspect fields**

### 2. Check product.template for partner restrictions
Go to: **Settings → Technical → Database Structure → Models → product.template**
Look for any field referencing `res.partner` (many2many or many2one).

### 3. Check for a custom model
Go to: **Settings → Technical → Database Structure → Models**
Search for any model with names like:
- `partner.product.access`
- `product.partner.visibility`
- `portal.product.restriction`
- Any model with `x_` prefix that references both partners and products

### 4. Check Odoo Studio custom fields
Go to: **Settings → Studio → [select Sales or Website app]**
Look for any custom fields added to product.template or res.partner.

### 5. Check pricelist configuration
Go to: **Sales → Configuration → Pricelists**
If each customer has a dedicated pricelist, check whether pricelists are configured with product-specific items:
- A pricelist with only certain products listed would act as visibility control
- Check `product.pricelist.item` records for the customer's pricelist

---

## Possible mechanisms (most to least likely)

| Mechanism | Where it lives | How to detect |
|---|---|---|
| Custom Studio field on `product.template` | `product.template.x_allowed_partner_ids` | Check model fields in Settings → Technical |
| Custom Studio field on `res.partner` | `res.partner.x_visible_product_ids` or `x_visible_category_ids` | Inspect partner record fields |
| Pricelist-based visibility | `product.pricelist.item` (only certain products listed) | Check pricelist items for your test customers |
| Custom module model | e.g., `partner.product.access` | Search all models for cross-references |
| `product.public.category` restriction | Field on category linking to allowed partners | Check category model fields |
| `website.published_partner_ids` | Custom field on `product.website.settings` | Check website settings model |

---

## What the implementation will look like once the field is known

Once the exact field/model is confirmed, the implementation will:

1. In `fetchOdooProducts()`: add an additional domain filter based on the customer's `partner_id`
2. Fetch the allowed product/category IDs for the customer at login (or cached with TTL)
3. Intersect with the existing website-published domain filter
4. Return only products the customer is allowed to see

The customer's `partner_id` is available in the session cookie and passed through to all
Odoo queries. No client-side changes are needed — all filtering happens server-side in the BFF.

---

## Required information before implementation

Please report back:
- The exact model name where partner-product restrictions are stored
- The exact field name(s) involved
- A sample query result showing what the field looks like for a restricted customer vs. an unrestricted one
- Whether the restriction is at product level, category level, or both

If no restriction mechanism exists in Odoo, that should also be explicitly confirmed
so the portal can be documented as "all customers see all published products."
