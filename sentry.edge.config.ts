import * as Sentry from '@sentry/nextjs'

// Edge runtime (middleware). No-ops when SENTRY_DSN is unset.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? 'development',
  tracesSampleRate: 0,
  sendDefaultPii: false,
})
