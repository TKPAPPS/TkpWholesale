'use client'

// Client-side session helpers. Every browser call to /api/auth/me goes through fetchMe()
// so logout() can wait for the ones already on the wire.
//
// Why: /api/auth/me ROLLS the session (re-issues the cookie on every 200). A re-check that
// is in flight when the customer taps Log out (the layout fires one on every return to the
// tab) answers AFTER the logout and puts the cookie back. /login then sees a signed-in user
// and bounces to /dashboard, so Log out "does nothing". Reproduced in WebKit 20/11/2026;
// Safari on iPhone hits it constantly because returning to the tab is the normal gesture.

const inflight = new Set<Promise<Response>>()
let loggingOut = false

export function isLoggingOut(): boolean {
  return loggingOut
}

export function fetchMe(): Promise<Response> {
  const p = fetch('/api/auth/me', { cache: 'no-store' })
  inflight.add(p)
  const done = () => { inflight.delete(p) }
  p.then(done, done)
  return p
}

export async function logout(): Promise<void> {
  loggingOut = true
  // 1. Let any re-check already on the wire land first, since its answer re-sets the cookie.
  await Promise.race([
    Promise.allSettled(Array.from(inflight)),
    new Promise((r) => setTimeout(r, 5000)),
  ])
  // 2. Clear, then confirm with the server. If something still re-set the cookie, clear again.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }) } catch { /* retried below */ }
    try {
      const check = await fetch('/api/auth/me', { cache: 'no-store' })
      if (!check.ok) break
    } catch { break }
  }
  try { sessionStorage.removeItem('b2b_user') } catch { /* unavailable */ }
  // 3. Full page load, not a client route change: it drops every in-memory store (cart,
  //    favourites, user) of the customer who just left, so the next person starts clean.
  window.location.replace('/login')
}
