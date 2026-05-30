import { NextRequest, NextResponse } from 'next/server'
import { getOdooSession } from '@/lib/odoo/admin-session'
import { parseSession } from '@/lib/odoo/session'

const ODOO_URL = process.env.ODOO_URL!
const SIZE_MAP: Record<string, string> = {
  '128': 'image_128',
  '256': 'image_256',
  '512': 'image_512',
  '1024': 'image_1024',
}

export async function GET(req: NextRequest, { params }: { params: { id: string; size: string } }) {
  if (!parseSession(req)) {
    return new NextResponse(null, { status: 401 })
  }

  const field = SIZE_MAP[params.size] ?? 'image_512'
  const url = `${ODOO_URL}/web/image/product.template/${params.id}/${field}`

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
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
