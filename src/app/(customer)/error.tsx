'use client'
import { useEffect } from 'react'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { Button } from '@/components/ui/Button'
import { AlertTriangle } from 'lucide-react'
import { reportClientError } from '@/lib/report-client-error'

// Route-level error boundary for all customer pages: an uncaught render error
// shows a branded retry state instead of Next's unstyled crash page. The
// Navbar/layout above stays mounted, so the customer can also just navigate away.
export default function CustomerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { lang } = useLangStore()

  // A crash reaching this boundary is otherwise invisible server-side (this app has no
  // Sentry) - report it so it shows up in `vercel logs --level error`. Deps are [error]
  // only: `lang` is UI text here, and depending on it re-fired a duplicate report when
  // the store hydrated post-mount or the user toggled language on the crash page.
  useEffect(() => { reportClientError('customer-error', error) }, [error])

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <AlertTriangle className="h-12 w-12 text-amber-500" />
      <h1 className="text-lg font-bold text-gray-900">{t(lang, 'common.errorTitle')}</h1>
      <p className="text-sm text-gray-500 max-w-md">{t(lang, 'common.errorBody')}</p>
      <Button onClick={reset}>{t(lang, 'common.tryAgain')}</Button>
    </div>
  )
}
