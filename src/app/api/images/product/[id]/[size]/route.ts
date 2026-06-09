import { NextRequest, NextResponse } from 'next/server'
import { getOdooSession } from '@/lib/odoo/admin-session'

const ODOO_URL = process.env.ODOO_URL!
const SIZE_MAP: Record<string, string> = {
  '128': 'image_128',
  '256': 'image_256',
  '512': 'image_512',
  '1024': 'image_1024',
}

// Intentionally NOT session-gated. Two reasons: (1) the same images are already
// public on Odoo's own /web/image endpoint and are served CDN-public via the
// Cache-Control below, so gating added no real protection; (2) the Vercel image
// optimizer fetches this route server-side without the user's session cookie, so a
// 401 gate would break <Image> optimization. Product photos are non-sensitive.
export async function GET(_req: NextRequest, { params }: { params: { id: string; size: string } }) {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse(null, { status: 400 })
  }

  const field = SIZE_MAP[params.size] ?? 'image_512'
  const url = `${ODOO_URL}/web/image/product.template/${id}/${field}`

  const headers: Record<string, string> = { Accept: 'image/*' }
  try {
    const token = await getOdooSession()
    const apikey = token.split(':').slice(1).join(':')
    headers.Authorization = `Bearer ${apikey}`
  } catch { /* proceed without auth — public images may still work */ }

  try {
    const res = await fetch(url, { headers })

    if (!res.ok) return new NextResponse(null, { status: 404 })

    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? 'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        // public so Vercel's CDN caches the proxied image at the edge: the first
        // visitor warms it, everyone after skips the Odoo round-trip.
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
