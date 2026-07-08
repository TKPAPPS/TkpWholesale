// Shared, defensive pagination parsing for list API routes.
// Unvalidated page/per_page params otherwise let a negative page produce a
// negative Odoo OFFSET (500 → dropped admin-token cache), a huge per_page
// exhaust resources, and NaN silently serve page 0.

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
