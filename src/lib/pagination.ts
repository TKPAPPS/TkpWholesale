// Shared, defensive query-param parsing for list API routes.
// Unvalidated page/per_page params otherwise let a negative page produce a
// negative Odoo OFFSET (500 → dropped admin-token cache), a huge per_page
// exhaust resources, and NaN silently serve page 0.

// Date filters land in Odoo domain terms (`created_after`, `date_from`, `date_to`), where an
// unparseable value makes Odoo raise. That matters more than it looks: every list route
// answers a thrown Odoo call with invalidateOdooSession(), which drops the admin token cached
// in module memory and shared by every user on that instance. So one client sending
// `?date_from=x` forces a re-authentication for everyone else served by the same instance.
// Callers reject rather than silently ignore: a filter that quietly fails to apply shows the
// customer the wrong result set and looks like missing data.
//
// Only 'YYYY-MM-DD' is accepted, which is exactly what every caller sends today (an
// <input type="date"> on the orders page, toISOString().split('T')[0] on new arrivals).
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

export interface Pagination {
  page: number
  perPage: number
  offset: number
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultPerPage: number,
  maxPerPage = 100,
): Pagination {
  const rawPage = Number(searchParams.get('page'))
  const rawPerPage = Number(searchParams.get('per_page'))

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 0
  const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0
    ? Math.min(Math.floor(rawPerPage), maxPerPage)
    : defaultPerPage

  return { page, perPage, offset: page * perPage }
}
