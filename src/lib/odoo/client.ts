const ODOO_URL = process.env.ODOO_URL!
const ODOO_DB = process.env.ODOO_DB!

export class OdooError extends Error {
  constructor(
    message: string,
    public code?: string,
    public odooData?: unknown,
  ) {
    super(message)
  }
}

// Low-level JSON-RPC call — pass the Odoo session_id cookie
export async function odooRpc(
  endpoint: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sessionId) headers['Cookie'] = `session_id=${sessionId}`

  const res = await fetch(`${ODOO_URL}${endpoint}`, {
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

// Authenticate a portal user — returns { uid, session_id }
export async function odooAuthenticate(login: string, password: string): Promise<{ uid: number; session_id: string; partner_id: number; lang: string }> {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
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

  const json = (await res.json()) as { result?: { uid: number | false; partner_id: number; lang: string } }

  if (!json.result?.uid) throw new OdooError('Invalid credentials', 'INVALID_CREDENTIALS')
  if (!sessionId) throw new OdooError('No session returned', 'SESSION_ERROR')

  return {
    uid: json.result.uid as number,
    session_id: sessionId,
    partner_id: json.result.partner_id,
    lang: json.result.lang,
  }
}

// Shorthand: call_kw helper
export async function callKw(
  sessionId: string,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  return odooRpc('/web/dataset/call_kw', { model, method, args, kwargs }, sessionId)
}

// search_read shorthand
export async function searchRead(
  sessionId: string,
  model: string,
  domain: unknown[],
  fields: string[],
  opts: { limit?: number; offset?: number; order?: string; context?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>[]> {
  return callKw(sessionId, model, 'search_read', [domain], {
    fields,
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
    order: opts.order ?? '',
    context: opts.context ?? {},
  }) as Promise<Record<string, unknown>[]>
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
    // ignore — session may already be expired
  }
}
