# Error Codes

All API error responses follow the shape:
```json
{ "error": "<CODE>", "message": "<human readable>", "details": {} }
```

## Auth

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `NOT_PORTAL_USER` | 403 | Account exists but is not a portal user |
| `ACCOUNT_INACTIVE` | 403 | Portal user is archived in Odoo |
| `SESSION_EXPIRED` | 401 | iron-session cookie expired or Odoo session invalidated |
| `NOT_AUTHENTICATED` | 401 | No session cookie present |

## Products & Categories

| Code | HTTP | Meaning |
|---|---|---|
| `PRODUCT_NOT_FOUND` | 404 | Product does not exist or is not visible to this customer |
| `CATEGORY_NOT_FOUND` | 404 | Category not found |

## Cart

| Code | HTTP | Meaning |
|---|---|---|
| `CART_NOT_FOUND` | 404 | No active cart for this customer |
| `CART_ALREADY_CONFIRMED` | 400 | Tried to modify or clear a confirmed order |
| `PRODUCT_NOT_AVAILABLE` | 400 | Product is not visible to this customer |
| `OUT_OF_STOCK` | 400 | Product is out of stock and not allowed to be ordered |
| `INVALID_PACKAGING` | 400 | packaging_id does not belong to this product |
| `INVALID_QTY` | 400 | packaging_qty must be a positive integer |
| `LINE_NOT_FOUND` | 404 | Cart line does not exist or belongs to another customer |

## Checkout

| Code | HTTP | Meaning |
|---|---|---|
| `CART_EMPTY` | 400 | Cannot confirm an empty cart |
| `INVALID_DELIVERY_ADDRESS` | 400 | delivery_address_id not in customer's address list |
| `VALIDATION_FAILED` | 400 | One or more lines are invalid (out of stock or hidden) |
| `ORDER_CONFIRM_FAILED` | 502 | Odoo returned an error during action_confirm |
| `ALREADY_CONFIRMED` | 200 | Order was already confirmed (idempotent success) |

## Orders

| Code | HTTP | Meaning |
|---|---|---|
| `ORDER_NOT_FOUND` | 404 | Order not found |
| `ORDER_ACCESS_DENIED` | 403 | Order belongs to another customer |
| `PDF_NOT_AVAILABLE` | 503 | Odoo could not generate PDF |

## Infrastructure

| Code | HTTP | Meaning |
|---|---|---|
| `ODOO_UNAVAILABLE` | 503 | Cannot reach Odoo (timeout or connection refused) |
| `ODOO_SESSION_INVALID` | 401 | Odoo rejected the session (re-login required) |
| `ODOO_ERROR` | 502 | Odoo returned an RPC error |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Favorites

| Code | HTTP | Meaning |
|---|---|---|
| `ALREADY_FAVORITED` | 400 | Product already in favorites |
| `FAVORITE_NOT_FOUND` | 404 | Cannot remove non-existent favorite |

---

## Client-side handling guide

| Code | UX behaviour |
|---|---|
| `SESSION_EXPIRED` / `NOT_AUTHENTICATED` | Redirect to `/login` with `?redirect=<current_path>` |
| `ODOO_UNAVAILABLE` | Show `OdooUnavailable` component (see components/ui/OdooUnavailable) |
| `VALIDATION_FAILED` | Show per-line warnings in cart/checkout |
| `ALREADY_CONFIRMED` | Treat as success, redirect to order confirmation |
| `RATE_LIMITED` | Show "Too many requests, please wait" toast |
| `INTERNAL_ERROR` | Show generic error state with "try again" button |
| `PRODUCT_NOT_AVAILABLE` / `OUT_OF_STOCK` | Show inline error on product card / add-to-cart button |
