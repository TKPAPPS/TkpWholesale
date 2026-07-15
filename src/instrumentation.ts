import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Captures unhandled route-handler/server-component errors on Next 15+;
// harmless (ignored) on Next 14, and saves a migration step later.
export const onRequestError = Sentry.captureRequestError
