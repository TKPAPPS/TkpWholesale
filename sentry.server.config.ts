import * as Sentry from '@sentry/nextjs'

// No-ops entirely when SENTRY_DSN is unset (init with undefined dsn = disabled).
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? 'development',
  tracesSampleRate: 0.05,
  // Never attach request bodies/cookies: sessions and order payloads are sensitive.
  sendDefaultPii: false,
})
