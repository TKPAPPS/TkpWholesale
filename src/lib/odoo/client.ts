const ODOO_URL = (process.env.ODOO_URL ?? '').replace(/\/$/, '')
const ODOO_DB = process.env.ODOO_DB!

// The ONE company this portal serves: The Kosher Place (Thailand) Co. Ltd, which is the
// company of website 3. The Odoo database holds ~20 sibling companies (Jcafe Sukhumvit,
// TKP Samui, Chabad entities...) that share partners and products, so without an explicit
// scope every query silently spans all of them - that is how customers ended up seeing
// other companies' invoices. See COMPANY SCOPING in CLAUDE.md.
// Parsed defensively: `??` alone would let an EMPTY env var through as Number('') = 0, and a
// company id of 0 makes Odoo raise AccessError on env.company for every single call, i.e. the
// entire portal 503s. Anything not a positive integer falls back to 1.
const _rawCompanyId = Number(process.env.ODOO_COMPANY_ID)
export const COMPANY_ID = Number.isInteger(_rawCompanyId) && _rawCompanyId > 0 ? _rawCompanyId : 1

// Every Odoo call gets a hard timeout. Without it a hung/blackholed connection
// stalls the request for the full platform function timeout, and - because the
// admin auth promise is shared (admin-session.ts _inflight) - one stuck auth can
// stall every concurrent request on the instance until that limit.
const ODOO_TIMEOUT_MS = 15_000

export class OdooError extends Error {
  constructor(
    message: string,
    public code?: string,
    public odooData?: unknown,
  ) {
    super(message)
  }
}

// fetch() with an AbortSignal timeout, surfaced as a typed OdooError.
async function odooFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ODOO_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new OdooError('Odoo request timed out', 'TIMEOUT')
    }
    throw new OdooError('Could not reach Odoo', 'NETWORK_ERROR', err)
  }
}

// Low-level JSON-RPC call - pass the Odoo session_id cookie
export async function odooRpc(
  endpoint: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sessionId) headers['Cookie'] = `session_id=${sessionId}`

  const res = await odooFetch(`${ODOO_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params }),
  })

  if (!res.ok) throw new OdooError(`HTTP ${res.status}`, 'HTTP_ERROR')

  const json = (await res.json()) as { result?: unknown; error?: { message: string; data?: { name: string } } }

  if (json.error) {
    throw new OdooError(json.error.message, json.error.data?.name, json.error)
  }

  return json.result
}

// Authenticate a portal user - returns { uid, session_id }
export async function odooAuthenticate(login: string, password: string): Promise<{ uid: number; session_id: string; partner_id: number; lang: string }> {
  const res = await odooFetch(`${ODOO_URL}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { db: ODOO_DB, login, password },
    }),
  })

  const setCookie = res.headers.get('set-cookie') ?? ''
  const sessionId = setCookie.match(/session_id=([^;]+)/)?.[1]

  const json = (await res.json()) as {
    result?: { uid: number | false; partner_id: number; lang: string }
    error?: { message: string; data?: { name?: string; message?: string } }
  }

  // Distinguish a genuine bad-credentials result from an Odoo-side error (wrong
  // DB name, server error). Masking the latter as INVALID_CREDENTIALS makes a
  // launch-day misconfig look like every customer suddenly has the wrong
  // password, with nothing logged.
  if (json.error) {
    // A wrong password comes back as an ERROR named odoo.exceptions.AccessDenied, not as
    // uid:false. Treating it as a generic ODOO_ERROR made the login route answer 503
    // "Could not reach Odoo" for every mistyped password, so customers were told the system
    // was down and contacted their sales rep instead of simply retrying.
    if (json.error.data?.name === 'odoo.exceptions.AccessDenied') {
      throw new OdooError('Invalid credentials', 'INVALID_CREDENTIALS')
    }
    throw new OdooError(json.error.data?.message || json.error.message, 'ODOO_ERROR', json.error)
  }
  if (json.result?.uid === false) throw new OdooError('Invalid credentials', 'INVALID_CREDENTIALS')
  if (!json.result?.uid) throw new OdooError('Invalid credentials', 'INVALID_CREDENTIALS')
  if (!sessionId) throw new OdooError('No session returned', 'SESSION_ERROR')

  return {
    uid: json.result.uid as number,
    session_id: sessionId,
    partner_id: json.result.partner_id,
    lang: json.result.lang,
  }
}

// External JSON-RPC call using uid + API key (no web session needed).
// Odoo.com SaaS instances don't accept API keys via /web/session/authenticate,
// but they work fine through the /jsonrpc service=object path.
async function callKwExternal(
  uid: number,
  apikey: string,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown>,
): Promise<unknown> {
  const res = await odooFetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: 1,
      params: { service: 'object', method: 'execute_kw', args: [ODOO_DB, uid, apikey, model, method, args, kwargs] },
    }),
  })
  if (!res.ok) throw new OdooError(`HTTP ${res.status}`, 'HTTP_ERROR')
  const json = (await res.json()) as { result?: unknown; error?: { message: string; data?: { name: string; message: string } } }
  if (json.error) throw new OdooError(json.error.data?.message || json.error.message, 'ODOO_ERROR', json.error)
  return json.result
}

// Authenticate via the external JSON-RPC common service (works with API keys on SaaS).
export async function adminAuthenticate(login: string, apikey: string): Promise<number> {
  const res = await odooFetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: 1,
      params: { service: 'common', method: 'authenticate', args: [ODOO_DB, login, apikey, {}] },
    }),
  })
  if (!res.ok) throw new OdooError(`HTTP ${res.status}`, 'HTTP_ERROR')
  const json = (await res.json()) as { result?: number | false; error?: { message: string; data?: { message?: string } } }
  if (json.error) {
    throw new OdooError(json.error.data?.message || json.error.message, 'ODOO_ERROR', json.error)
  }
  const uid = json.result
  if (!uid) throw new OdooError('Invalid credentials', 'INVALID_CREDENTIALS')
  return uid
}

// Shorthand: call_kw helper.
// sessionId can be:
//   - a real Odoo web session ID (hex string) - used for customer session calls
//   - "uid:apikey" format - used for admin API key calls (routes to /jsonrpc automatically)
//
// `opts.scopeToCompany: false` opts a call OUT of the global company scope. Use it ONLY for
// reads of a customer's own IDENTITY record (res.partner: pricelist, fiscal position, hidden
// products, addresses). Those partners are frequently owned by a sibling company (336 of 583
// active users), and Odoo raises AccessError on `read()` of a record outside the scope, which
// surfaces as a 503 on pricing, VAT, the address picker and the invoice bill-to block.
// Dropping the scope is safe there for two reasons: the record IS the caller's own, and the
// API user's default company is company 1, so company-dependent properties still resolve
// against company 1 (verified in production). NEVER use it for business documents
// (sale.order, account.move, stock) - that is exactly the cross-company leak we closed.
export async function callKw(
  sessionId: string,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
  opts: { scopeToCompany?: boolean } = {},
): Promise<unknown> {
  const adminMatch = sessionId.match(/^(\d+):(.+)$/)

  if (adminMatch && opts.scopeToCompany === false) {
    return callKwExternal(Number(adminMatch[1]), adminMatch[2], model, method, args, kwargs)
  }

  if (adminMatch) {
    // GLOBAL COMPANY SCOPE, admin path only. Every customer-visible query in the app (catalog,
    // orders, invoices, cart) runs through this admin session, so scoping here still isolates
    // sibling companies everywhere it matters. It also fixes company-dependent PROPERTY fields
    // (property_product_pricelist / property_account_position_id), which resolve against
    // env.company and cannot be constrained by a domain. Records with company_id = false
    // (products, packagings, categories, most partners) stay visible, so the catalog is intact.
    // Merged first so a caller's own context keys (lang, location, ...) are preserved.
    const context = { allowed_company_ids: [COMPANY_ID], ...((kwargs.context as Record<string, unknown>) ?? {}) }
    return callKwExternal(Number(adminMatch[1]), adminMatch[2], model, method, args, { ...kwargs, context })
  }

  // CUSTOMER web session: deliberately NOT company-scoped. Odoo raises
  // AccessError("Access to unauthorized or invalid company") whenever allowed_company_ids
  // names a company the acting user does not belong to, and 503 of 555 active portal users
  // sit on sibling companies (mostly Jcafe Sukhumvit, id 15) rather than company 1. Forcing
  // the scope here locked them all out of the portal: Odoo accepted their password, then the
  // very next call threw and login returned a 503. This path is used only by the login route,
  // to read the user's OWN res.users and res.partner row, so there is nothing to isolate.
  return odooRpc('/web/dataset/call_kw', { model, method, args, kwargs }, sessionId)
}

// search_read shorthand
export async function searchRead(
  sessionId: string,
  model: string,
  domain: unknown[],
  fields: string[],
  opts: { limit?: number; offset?: number; order?: string; context?: Record<string, unknown>; scopeToCompany?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  return callKw(sessionId, model, 'search_read', [domain], {
    fields,
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
    order: opts.order ?? '',
    context: opts.context ?? {},
  }, { scopeToCompany: opts.scopeToCompany }) as Promise<Record<string, unknown>[]>
}

// Verify the user is an active Odoo user (portal or internal)
export async function verifyPortalUser(sessionId: string, uid: number): Promise<boolean> {
  const result = await callKw(sessionId, 'res.users', 'read', [[uid]], {
    fields: ['active'],
  }) as { active: boolean }[]
  return result[0]?.active === true
}

// Destroy Odoo session (logout)
export async function destroySession(sessionId: string): Promise<void> {
  try {
    await odooRpc('/web/session/destroy', {}, sessionId)
  } catch {
    // ignore - session may already be expired
  }
}
