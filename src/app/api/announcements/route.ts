import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = createServerClient()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('announcements')
      .select('id, message, type')
      .eq('active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) return NextResponse.json({ announcement: null })
    return NextResponse.json({ announcement: data?.[0] ?? null })
  } catch {
    return NextResponse.json({ announcement: null })
  }
}
