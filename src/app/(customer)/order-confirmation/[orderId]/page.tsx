'use client'
import { useParams } from 'next/navigation'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

export default function OrderConfirmationPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const { lang } = useLangStore()

  return (
    <div className="max-w-md mx-auto text-center py-16">
      <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{t(lang, 'confirmation.title')}</h1>
      <p className="text-gray-500 mb-2">{t(lang, 'confirmation.subtitle')}</p>
      <p className="text-sm text-gray-400 mb-8">
        {t(lang, 'confirmation.orderNumber')}:{' '}
        <span className="font-semibold text-gray-700">S00123</span>
      </p>
      <p className="text-sm text-gray-500 mb-8">
        A confirmation email has been sent by our system. Delivery will be arranged by our team.
      </p>
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
