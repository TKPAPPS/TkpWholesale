import { NextRequest, NextResponse } from 'next/server'

// Pages reachable without logging in. Everything else requires a session cookie.
const PUBLIC_PATHS = new Set(['/', '/login', '/contact', '/privacy', '/terms'])

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Admin area — requires the admin_session cookie (except the admin login page).
  // Full token validation happens in each admin API route; middleware only checks
  // cookie presence so the redirect is instant (no network call needed).
  if (pathname.startsWith('/admin')) {
    if (pathname !== '/admin/login' && !req.cookies.get('admin_session')?.value) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
    return NextResponse.next()
  }

  // Public pages — always allowed.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()

  // Everything else is a customer page — require a session cookie, otherwise send
  // to login with a redirect back. (Cookie validity is enforced by the API routes
  // and the customer layout; middleware just gates access to the page shell.)
  if (!req.cookies.get('session')?.value) {
    const url = new URL('/login', req.url)
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  // Run on all page routes; skip API routes, Next internals, and static files
  // (anything with a file extension).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)'],
}
