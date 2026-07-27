'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { CheckCircle, Repeat, AlertTriangle } from 'lucide-react'

export default function OrderConfirmationPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const searchParams = useSearchParams()
  const { lang } = useLangStore()
  const [orderName, setOrderName] = useState<string | null>(searchParams.get('name'))
  const scheduled = searchParams.get('scheduled') === '1'
  const scheduleError = searchParams.get('schedule_error') === '1'
  const removedCount = Number(searchParams.get('removed')) || 0

  useEffect(() => {
    if (orderName) return
    fetch(`/api/orders/${orderId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.name) setOrderName(d.name) })
      .catch(() => {})
  }, [orderId])

  return (
    <div className="max-w-md mx-auto text-center py-16">
      <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{t(lang, 'confirmation.title')}</h1>
      <p className="text-gray-500 mb-2">{t(lang, 'confirmation.subtitle')}</p>
      <p className="text-sm text-gray-400 mb-8">
        {t(lang, 'confirmation.orderNumber')}:{' '}
        <span className="font-semibold text-gray-700">{orderName ?? '…'}</span>
      </p>
      <p className="text-sm text-gray-500 mb-8">
        A confirmation email has been sent by our system. Delivery will be arranged by our team.
      </p>
      {scheduled && (
        <div className="mb-8 flex items-center justify-center gap-2 text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg p-3">
          <Repeat className="h-4 w-4 shrink-0" />
          <span>{t(lang, 'checkout.scheduleCreated')} <Link href="/scheduled-orders" className="underline font-medium">{t(lang, 'nav.scheduledOrders')}</Link></span>
        </div>
      )}
      {scheduleError && (
        <div className="mb-8 flex items-center justify-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{t(lang, 'checkout.scheduleError')}</span>
        </div>
      )}
      {removedCount > 0 && (
        <div className="mb-8 flex items-center justify-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{t(lang, 'confirmation.itemsRemoved').replace('{n}', String(removedCount))}</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href={`/orders/${orderId}`}>
          <Button variant="secondary">{t(lang, 'confirmation.viewOrder')}</Button>
        </Link>
        <Link href="/products">
          <Button>{t(lang, 'confirmation.continueOrdering')}</Button>
        </Link>
      </div>
    </div>
  )
}
