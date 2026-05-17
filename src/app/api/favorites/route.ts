import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { createServerClient } from '@/lib/supabase'
import { fetchOdooProducts } from '@/lib/odoo/odoo-helpers'

export async function GET(req: NextRequest) {
  const session = parseSession(req)
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  let supabase
  try {
    supabase = createServerClient()
  } catch {
    return NextResponse.json(
      { error: 'SUPABASE_NOT_CONFIGURED', message: 'Favorites require Supabase. See docs/local-setup-status.md.' },
      { status: 503 },
    )
  }

  const { data: rows, error } = await supabase
    .from('favorites')
    .select('template_id')
    .eq('partner_id', session.partner_id)

  if (error) {
    console.error('Supabase favorites GET error:', error)
    return NextResponse.json({ favorites: [] })
  }

  const templateIds = rows.map((r: { template_id: number }) => r.template_id)
  if (templateIds.length === 0) return NextResponse.json({ favorites: [] })

  const domain = [['id', 'in', templateIds]]
  const { products } = await fetchOdooProducts(
    session.odoo_session_id, domain, {}, session.pricelist_id ?? undefined,
  )
  return NextResponse.json({ favorites: products })
}

export async function POST(req: NextRequest) {
  const session = parseSession(req)
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const body = await req.json()
  const template_id = Number(body?.template_id)
  if (!template_id) return NextResponse.json({ error: 'INVALID_TEMPLATE_ID' }, { status: 400 })

  let supabase
  try {
    supabase = createServerClient()
  } catch {
    return NextResponse.json(
      { error: 'SUPABASE_NOT_CONFIGURED', message: 'Favorites require Supabase. See docs/local-setup-status.md.' },
      { status: 503 },
    )
  }

  const { error } = await supabase
    .from('favorites')
    .upsert({ partner_id: session.partner_id, template_id }, { onConflict: 'partner_id,template_id' })

  if (error) {
    console.error('Supabase favorites POST error:', error)
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 })
  }

  return NextResponse.json({ added: true, template_id })
}
