import * as Sentry from '@sentry/nextjs'

// No-ops when NEXT_PUBLIC_SENTRY_DSN is unset. Replay deliberately excluded
// (bundle weight + privacy); errors and a small trace sample only.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
  tracesSampleRate: 0.05,
  sendDefaultPii: false,
})
