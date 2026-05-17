import { NextRequest, NextResponse } from 'next/server'
import { parseSession } from '@/lib/odoo/session'
import { createServerClient } from '@/lib/supabase'

export async function DELETE(req: NextRequest, { params }: { params: { templateId: string } }) {
  const session = parseSession(req)
  if (!session) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 })

  const templateId = Number(params.templateId)
  if (!templateId) return NextResponse.json({ error: 'INVALID_TEMPLATE_ID' }, { status: 400 })

  const supabase = createServerClient()
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('partner_id', session.partner_id)
    .eq('template_id', templateId)

  if (error) {
    console.error('Supabase favorites DELETE error:', error)
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 })
  }

  return NextResponse.json({ removed: true, templateId })
}
