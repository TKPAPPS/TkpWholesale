'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLangStore } from '@/store/langStore'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency } from '@/lib/utils'
import { Cart, DeliveryAddress } from '@/types'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { CartSummary } from '@/components/cart/CartSummary'
import { Package, AlertTriangle, CheckCircle, Repeat } from 'lucide-react'
import { WEEKDAY_SHORT_EN, WEEKDAY_SHORT_HE, type ScheduleFrequency } from '@/lib/scheduled-orders'
import { todayBkk, addDays } from '@/lib/schedule-dates'
import Link from 'next/link'
import Image from 'next/image'

// Product thumbnail with a graceful fallback to a placeholder icon (matches the cart/mini-cart).
function LineThumb({ src }: { src: string }) {
  const [imgError, setImgError] = useState(false)
  if (!src || imgError) {
    return (
      <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <Package className="h-4 w-4 text-gray-300" />
      </div>
    )
  }
  return (
    <Image src={src} alt="" width={40} height={40}
      className="h-10 w-10 rounded-lg object-contain bg-gray-50 shrink-0"
      onError={() => setImgError(true)} />
  )
}

interface ReviewData extends Cart {
  valid: boolean
  blocking_errors: string[]
  delivery_addresses: DeliveryAddress[]
}

export default function CheckoutPage() {
  const { lang } = useLangStore()
  const noteMaxLength = useSiteSettingsStore((s) => s.settings.checkoutNoteMaxLength)
  const router = useRouter()
  const [review, setReview] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [poRef, setPoRef] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  // Repeating order controls
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<ScheduleFrequency>('weekly')
  const [intervalWeeks, setIntervalWeeks] = useState(1)
  const [excludedDays, setExcludedDays] = useState<number[]>([])
  const [scheduleEnd, setScheduleEnd] = useState('')
  const weekdayLabels = lang === 'he' ? WEEKDAY_SHORT_HE : WEEKDAY_SHORT_EN
  const todayStr = todayBkk()

  const toggleExcludedDay = (d: number) =>
    setExcludedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const fetchReview = async () => {
    setLoading(true)
    setOdooError(false)
    try {
      const res = await fetch('/api/checkout/review')
      // Session expired mid-checkout — send the user to login rather than crashing
      // on review.lines.map (the error body has no lines).
      if (res.status === 401) {
        router.push(`/login?redirect=${encodeURIComponent('/checkout')}`)
        return
      }
      if (!res.ok) { setOdooError(true); return }
      const data = await res.json()
      setReview(data)
      setSelectedAddress(data.delivery_addresses?.[0]?.id ?? null)
    } catch { setOdooError(true) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchReview() }, [])

  const confirm = async () => {
    if (!selectedAddress) return
    setConfirming(true)
    setConfirmError('')
    try {
      const schedule = repeat
        ? {
            frequency,
            ...(frequency === 'weekly' ? { interval_weeks: intervalWeeks } : { excluded_weekdays: excludedDays }),
            end_date: scheduleEnd || null,
          }
        : undefined
      const res = await fetch('/api/checkout/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_address_id: selectedAddress, note, po_ref: poRef, delivery_date: deliveryDate, schedule }),
      })
      const data = await res.json()
      if (!res.ok) { setConfirmError(data.message ?? 'Could not confirm order.'); return }
      const params = new URLSearchParams({ name: data.order_name ?? '' })
      if (data.schedule_id) params.set('scheduled', '1')
      if (data.schedule_error) params.set('schedule_error', '1')
      router.push(`/order-confirmation/${data.order_id}?${params.toString()}`)
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
                <div className="flex items-center gap-2 min-w-0">
                  <LineThumb src={line.product_image_url} />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{lang === 'he' ? line.product_name_he : line.product_name}</p>
                    <p className="text-xs text-gray-400">{line.packaging_name} × {line.packaging_qty}</p>
                    {line.warnings.length > 0 && (
                      <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />
                        {line.warnings[0] === 'OUT_OF_STOCK' ? t(lang, 'checkout.lineOutOfStock') : line.warnings[0]}
                      </p>
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
                  <div className="text-sm min-w-0">
                    <p className="font-medium text-gray-900">{addr.name}</p>
                    <p className="text-gray-500 line-clamp-2">{addr.street}, {addr.city} {addr.zip}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* PO reference + requested delivery date */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">{t(lang, 'checkout.poRef')}</label>
              <input
                type="text"
                value={poRef}
                onChange={(e) => setPoRef(e.target.value)}
                maxLength={100}
                placeholder={t(lang, 'checkout.poRefPlaceholder')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">{t(lang, 'checkout.deliveryDate')}</label>
              <input
                type="date"
                value={deliveryDate}
                min={todayStr}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
              />
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
              maxLength={noteMaxLength}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20 resize-none"
            />
            {note.length > noteMaxLength * 0.8 && (
              <p className={`mt-1 text-xs text-end ${note.length >= noteMaxLength ? 'text-red-500' : 'text-gray-400'}`}>
                {note.length} / {noteMaxLength}
              </p>
            )}
          </div>

          {/* Repeat this order */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                className="mt-1"
              />
              <div>
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Repeat className="h-4 w-4 text-brand-700" /> {t(lang, 'checkout.repeatOrder')}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">{t(lang, 'checkout.repeatOrderHint')}</p>
              </div>
            </label>

            {repeat && (
              <div className="mt-4 space-y-4 ps-1">
                {/* Frequency */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setFrequency('daily')}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${frequency === 'daily' ? 'border-brand-700 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600'}`}
                  >{t(lang, 'checkout.freqDaily')}</button>
                  <button
                    type="button"
                    onClick={() => setFrequency('weekly')}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${frequency === 'weekly' ? 'border-brand-700 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600'}`}
                  >{t(lang, 'checkout.freqWeekly')}</button>
                </div>

                {/* Weekly interval */}
                {frequency === 'weekly' && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>{t(lang, 'checkout.everyNWeeks')}</span>
                    <select
                      value={intervalWeeks}
                      onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
                    >
                      {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span>{t(lang, 'checkout.weeks')}</span>
                  </div>
                )}

                {/* Daily excluded weekdays */}
                {frequency === 'daily' && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">{t(lang, 'checkout.excludeDays')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {weekdayLabels.map((label, d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleExcludedDay(d)}
                          aria-pressed={excludedDays.includes(d)}
                          className={`h-9 w-9 rounded-full border text-xs ${excludedDays.includes(d) ? 'border-red-300 bg-red-50 text-red-600 line-through' : 'border-gray-200 text-gray-600'}`}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* End date */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t(lang, 'checkout.endDate')}</label>
                  <input
                    type="date"
                    value={scheduleEnd}
                    min={addDays(todayStr, 1)}
                    onChange={(e) => setScheduleEnd(e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Totals */}
          <CartSummary cart={review} showCheckoutButton={false} />

          {/* Confirm */}
          {confirmError && <p className="text-sm text-red-600 text-center">{confirmError}</p>}
          {!review.valid && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
              {review.blocking_errors?.includes('OUT_OF_STOCK_ITEMS') ? (
                <span>{t(lang, 'checkout.outOfStockBlock')} <Link href="/cart" className="underline font-medium">{t(lang, 'cart.title')}</Link></span>
              ) : (
                t(lang, 'checkout.validationFailed')
              )}
            </div>
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
