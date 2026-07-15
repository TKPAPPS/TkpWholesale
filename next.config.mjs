import { withSentryConfig } from '@sentry/nextjs'

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const config = {
  // Required on Next 14 for src/instrumentation.ts (Sentry server init) to run.
  experimental: { instrumentationHook: true },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.odoo.com',
        pathname: '/web/image/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }]
  },
}

// Sentry build wrapping: instruments route handlers/pages for error capture.
// Source-map upload is DISABLED (no SENTRY_AUTH_TOKEN in CI); runtime reporting
// only activates when SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN are set.
export default withSentryConfig(config, {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
  disableLogger: true,
})
