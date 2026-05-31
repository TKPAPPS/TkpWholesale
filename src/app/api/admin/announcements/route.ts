import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, verifyAdminToken } from '@/lib/supabase'

async function auth(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  return token ? verifyAdminToken(token) : null
}

export async function GET(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const supabase = createServerClient()
  const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false })
  return NextResponse.json({ announcements: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { message, type, expires_at } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'MISSING_MESSAGE' }, { status: 400 })
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('announcements')
    .insert({ message: message.trim(), type: type ?? 'info', expires_at: expires_at ?? null, active: true })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { id, active } = await req.json()
  const supabase = createServerClient()
  await supabase.from('announcements').update({ active }).eq('id', id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { searchParams } = req.nextUrl
  const id = Number(searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 })
  const supabase = createServerClient()
  await supabase.from('announcements').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
