'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency } from '@/lib/utils'
import { Cart, DeliveryAddress } from '@/types'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { CartSummary } from '@/components/cart/CartSummary'
import { Package, AlertTriangle, CheckCircle } from 'lucide-react'
import Link from 'next/link'

interface ReviewData extends Cart {
  valid: boolean
  blocking_errors: string[]
  delivery_addresses: DeliveryAddress[]
}

export default function CheckoutPage() {
  const { lang } = useLangStore()
  const router = useRouter()
  const [review, setReview] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  const fetchReview = async () => {
    setLoading(true)
    setOdooError(false)
    try {
      const res = await fetch('/api/checkout/review')
      if (res.status === 503) { setOdooError(true); return }
      const data = await res.json()
      setReview(data)
      setSelectedAddress(data.delivery_addresses[0]?.id ?? null)
    } catch { setOdooError(true) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchReview() }, [])

  const confirm = async () => {
    if (!selectedAddress) return
    setConfirming(true)
    setConfirmError('')
    try {
      const res = await fetch('/api/checkout/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_address_id: selectedAddress, note }),
      })
      const data = await res.json()
      if (!res.ok) { setConfirmError(data.message ?? 'Could not confirm order.'); return }
      router.push(`/order-confirmation/${data.order_id}?name=${encodeURIComponent(data.order_name ?? '')}`)
    } catch { setConfirmError('Unexpected error. Please try again.') }
    finally { setConfirming(false) }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">{t(lang, 'checkout.title')}</h1>

      {odooError && <OdooUnavailable onRetry={fetchReview} />}

      {review && (
        <div className="space-y-6">
          {/* Lines summary */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Order Items</h2>
            {review.lines.map((line) => (
              <div key={line.line_id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-gray-300" />
                  <div>
                    <p className="font-medium text-gray-900">{lang === 'he' ? line.product_name_he : line.product_name}</p>
                    <p className="text-xs text-gray-400">{line.packaging_name} × {line.packaging_qty}</p>
                    {line.warnings.length > 0 && (
                      <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{line.warnings[0]}</p>
                    )}
                  </div>
                </div>
                <span className="font-medium">{formatCurrency(line.price_total, review.currency)}</span>
              </div>
            ))}
          </div>

          {/* Delivery address */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{t(lang, 'checkout.deliveryAddress')}</h2>
            <div className="space-y-2">
              {review.delivery_addresses.map((addr) => (
                <label key={addr.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedAddress === addr.id ? 'border-brand-700 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="address" value={addr.id} checked={selectedAddress === addr.id} onChange={() => setSelectedAddress(addr.id)} className="mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">{addr.name}</p>
                    <p className="text-gray-500">{addr.street}, {addr.city} {addr.zip}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Order note */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">{t(lang, 'checkout.orderNote')}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(lang, 'checkout.orderNotePlaceholder')}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20 resize-none"
            />
          </div>

          {/* Totals */}
          <CartSummary cart={review} showCheckoutButton={false} />

          {/* Confirm */}
          {confirmError && <p className="text-sm text-red-600 text-center">{confirmError}</p>}
          {!review.valid && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">{t(lang, 'checkout.validationFailed')}</p>
          )}
          <p className="text-xs text-gray-400 text-center">{t(lang, 'checkout.confirmWarning')}</p>
          <Button onClick={confirm} loading={confirming} disabled={!review.valid || !selectedAddress} className="w-full" size="lg">
            <CheckCircle className="h-4 w-4 me-2" />
            {t(lang, 'checkout.confirmOrder')}
          </Button>
          <div className="text-center">
            <Link href="/cart" className="text-sm text-brand-700 hover:underline">{t(lang, 'common.back')} to cart</Link>
          </div>
        </div>
      )}
    </div>
  )
}
