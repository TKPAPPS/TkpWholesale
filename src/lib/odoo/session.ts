import { NextRequest } from 'next/server'

export interface OdooSession {
  uid: number
  partner_id: number
  commercial_partner_id: number
  odoo_session_id?: string  // no longer used for API calls; kept for backward compat
  lang: 'en' | 'he'
  pricelist_id: number | null
  name: string
  email: string
  pricelist_name: string
}

export function parseSession(req: NextRequest): OdooSession | null {
  const raw = req.cookies.get('session')?.value
  if (!raw) return null
  try {
    return JSON.parse(raw) as OdooSession
  } catch {
    return null
  }
}

export function langContext(lang: 'en' | 'he'): Record<string, unknown> {
  return { lang: lang === 'he' ? 'he_IL' : 'en_US' }
}
