import { NextRequest, NextResponse } from 'next/server'

const ODOO_URL = process.env.ODOO_URL!
const SIZE_MAP: Record<string, string> = {
  '128': 'image_128',
  '512': 'image_512',
  '1024': 'image_1024',
}

export async function GET(req: NextRequest, { params }: { params: { id: string; size: string } }) {
  const field = SIZE_MAP[params.size] ?? 'image_512'
  const url = `${ODOO_URL}/web/image/product.template/${params.id}/${field}`

  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/*' },
      // No auth needed — Odoo serves published product images publicly
    })

    if (!res.ok) {
      return new NextResponse(null, { status: 404 })
    }

    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? 'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
