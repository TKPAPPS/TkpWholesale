// Client-side crash reporter shared by BOTH error boundaries. Deliberately ZERO imports:
// global-error.tsx must stay dependency-free so it can never crash itself, and a module
// with no imports cannot pull anything in that would. One place for the payload shape,
// the transport, and the guards — so the two boundaries can't drift apart.

// One report per error object. Dedupes React StrictMode's dev double-invoke and any
// effect re-fire for the same crash (e.g. an unrelated re-render of the boundary).
const reported = new WeakSet<Error>()

export function reportClientError(boundary: string, error: (Error & { digest?: string }) | undefined) {
  try {
    if (!error || reported.has(error)) return
    reported.add(error)
    // keepalive lets the request survive page unload — a user's reflexive reload on a crash
    // page would otherwise abort the in-flight POST and lose the report. `lang` is not sent:
    // the same-origin POST carries the lang cookie and the route reads it server-side.
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        boundary,
        message: error.message,
        digest: error.digest,
        stack: error.stack,
        url: window.location.href,
      }),
    }).catch(() => {})
  } catch {
    // Guards exotic errors (e.g. a throwing .stack getter) and patched fetch —
    // telemetry must never break the fallback UI it reports from.
  }
}
