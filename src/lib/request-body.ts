// Shared, defensive JSON body parsing for write API routes.
//
// `await req.json()` throws on a malformed or empty body, and returns null for a literal
// `null` body - which then throws again on destructuring. Neither was caught, so seven write
// routes answered HTTP 500 to a bad request, including both (pre-auth) login endpoints:
// `POST /api/auth/login` with an empty body returned 500 rather than a 4xx.
//
// Returning `{}` rather than a typed error is deliberate. Every caller already validates the
// individual fields it needs and returns its own specific 400/401, so an unparseable body
// takes exactly the same path as `{}` and produces the same message the client already
// handles. That keeps this a pure bug fix: no route changes its response for any body that
// used to work.
// The value type is `any` deliberately, matching what `req.json()` already returned. Every
// call site destructures and then validates each field itself, and narrowing to `unknown`
// here would force a cast at all eight of them without making any of them safer - the
// validation that actually guards these routes is the Number.isInteger / typeof check that
// follows, not the declared type of the parsed body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonObject(req: Request): Promise<Record<string, any>> {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  return body
}
