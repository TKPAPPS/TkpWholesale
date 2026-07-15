import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

// Must stay dynamic: with no request argument Next prerenders this route at
// build time and it never revalidates (same trap as /api/site-settings), so
// announcements would never appear or expire.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createServerClient()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('announcements')
      .select('id, message, type')
      .eq('active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) return NextResponse.json({ announcement: null })
    return NextResponse.json({ announcement: data?.[0] ?? null })
  } catch {
    return NextResponse.json({ announcement: null })
  }
}
