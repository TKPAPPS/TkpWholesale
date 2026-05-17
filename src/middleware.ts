import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Protect all /admin/* pages except the login page itself.
  // Full token validation happens in each API route; middleware only checks
  // cookie presence so the redirect is instant (no network call needed).
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const adminSession = req.cookies.get('admin_session')?.value
    if (!adminSession) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
