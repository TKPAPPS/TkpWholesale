// Storefront rules that the admin can tune, stored as JSON in the Odoo config
// parameter `b2b_portal.site_settings`. This module is import-safe on both the
// server (admin/public API routes) and the client (siteSettingsStore), so it must
// not import any server-only code.

export interface SiteSettings {
  lowStockThreshold: number      // show the "Low stock" badge when qty_available < this
  newArrivalsDays: number        // how far back /new-arrivals looks
  productsPerPage: number        // product grid page size
  ordersPerPage: number          // orders list page size
  invoicesPerPage: number        // invoices list page size
  checkoutNoteMaxLength: number  // max characters for the checkout order note
}

// Defaults match the values that were previously hardcoded in the customer UI, so
// behaviour is unchanged until the admin overrides a value.
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  lowStockThreshold: 20,
  newArrivalsDays: 30,
  productsPerPage: 24,
  ordersPerPage: 20,
  invoicesPerPage: 20,
  checkoutNoteMaxLength: 500,
}

// Allowed range per field. Used to validate the admin POST and to clamp values on read
// so a bad stored value can never break the storefront (e.g. perPage of 0).
export const SITE_SETTINGS_BOUNDS: Record<keyof SiteSettings, { min: number; max: number }> = {
  lowStockThreshold: { min: 0, max: 100_000 },
  newArrivalsDays: { min: 1, max: 365 },
  productsPerPage: { min: 4, max: 100 },
  ordersPerPage: { min: 5, max: 100 },
  invoicesPerPage: { min: 5, max: 100 },
  checkoutNoteMaxLength: { min: 0, max: 5_000 },
}

export const SITE_SETTINGS_KEYS = Object.keys(DEFAULT_SITE_SETTINGS) as (keyof SiteSettings)[]

// Coerce an arbitrary object into valid SiteSettings: ignore non-numbers, round, and
// clamp to bounds, falling back to the default for any missing/invalid field.
export function sanitizeSiteSettings(raw: unknown): SiteSettings {
  const out = { ...DEFAULT_SITE_SETTINGS }
  if (raw && typeof raw === 'object') {
    for (const key of SITE_SETTINGS_KEYS) {
      const v = (raw as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) {
        const { min, max } = SITE_SETTINGS_BOUNDS[key]
        out[key] = Math.min(max, Math.max(min, Math.round(v)))
      }
    }
  }
  return out
}
