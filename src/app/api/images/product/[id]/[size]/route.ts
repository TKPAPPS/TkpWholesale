import { NextRequest, NextResponse } from 'next/server'

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

  // Forward the Odoo session so staging instances return the actual image
  const headers: Record<string, string> = { Accept: 'image/*' }
  const raw = req.cookies.get('session')?.value
  if (raw) {
    try {
      const session = JSON.parse(raw) as { odoo_session_id?: string }
      if (session.odoo_session_id && session.odoo_session_id !== 'mock') {
        headers.Cookie = `session_id=${session.odoo_session_id}`
      }
    } catch { /* ignore */ }
  }

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
