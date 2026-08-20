import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, verifyAdminToken } from '@/lib/supabase'
import { readJsonObject } from '@/lib/request-body'

const TYPES = ['info', 'warning', 'success'] as const
type AnnouncementType = (typeof TYPES)[number]

async function auth(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  return token ? verifyAdminToken(token) : null
}

// Accepts null/undefined (cleared) or a parseable ISO timestamp; rejects garbage.
function normalizeTimestamp(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return undefined // undefined = invalid
  return new Date(v).toISOString()
}

export async function GET(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const supabase = createServerClient()
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ announcements: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { message, type, starts_at, expires_at } = await readJsonObject(req)

  if (!message?.trim()) return NextResponse.json({ error: 'MISSING_MESSAGE' }, { status: 400 })
  const safeType: AnnouncementType = TYPES.includes(type) ? type : 'info'
  const starts = normalizeTimestamp(starts_at)
  const expires = normalizeTimestamp(expires_at)
  if (starts === undefined || expires === undefined) {
    return NextResponse.json({ error: 'INVALID_DATE', message: 'starts_at / expires_at must be valid timestamps or empty.' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('announcements')
    .insert({ message: message.trim(), type: safeType, starts_at: starts, expires_at: expires, active: true })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { id, active } = await readJsonObject(req)

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'INVALID_ID', message: 'id must be a positive integer.' }, { status: 400 })
  }
  if (typeof active !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_ACTIVE', message: 'active must be a boolean.' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('announcements').update({ active }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 })

  const supabase = createServerClient()
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
