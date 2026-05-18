import { NextRequest, NextResponse } from 'next/server'
import { getOdooSession } from '@/lib/odoo/admin-session'

const ODOO_URL = process.env.ODOO_URL!
const SIZE_MAP: Record<string, string> = {
  '128': 'image_128',
  '256': 'image_256',
  '512': 'image_512',
  '1024': 'image_1024',
}

export async function GET(req: NextRequest, { params }: { params: { id: string; size: string } }) {
  const field = SIZE_MAP[params.size] ?? 'image_512'
  const url = `${ODOO_URL}/web/image/product.template/${params.id}/${field}`

  const headers: Record<string, string> = { Accept: 'image/*' }
  try {
    const sessionId = await getOdooSession()
    headers.Cookie = `session_id=${sessionId}`
  } catch { /* proceed without auth — public images may still work */ }

  try {
    const res = await fetch(url, { headers })

    if (!res.ok) return new NextResponse(null, { status: 404 })

    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? 'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
