'use client'
import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-client-error'

// Root error boundary: catches render errors that escape every nested boundary
// (including the root layout). Must render its own <html>/<body>. Kept
// dependency-free (no stores, no i18n) so it can never crash itself — the report
// helper is the one allowed import because it has zero imports of its own.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // A crash reaching this boundary is otherwise invisible server-side (this app has no
  // Sentry) — report it so it shows up in `vercel logs --level error`.
  useEffect(() => { reportClientError('global-error', error) }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#fafaf9' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
            Please try again. If the problem continues, contact your sales representative.
          </p>
          <button
            onClick={reset}
            style={{ background: '#6B1535', color: '#fff', border: 0, borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
