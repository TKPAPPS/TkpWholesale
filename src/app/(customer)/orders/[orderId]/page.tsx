'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { OrderDetail } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToastStore } from '@/store/toastStore'
import { useCartStore } from '@/store/cartStore'
import { Package, ChevronLeft, Download, RefreshCw } from 'lucide-react'

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const { lang } = useLangStore()
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const showToast = useToastStore((s) => s.show)
  const fetchCart = useCartStore((s) => s.fetchCart)

  useEffect(() => {
    fetch(`/api/orders/${orderId}`)
      .then((r) => { if (!r.ok) { setNotFound(true); return null } return r.json() })
      .then((d) => { if (d) setOrder(d) })
      .finally(() => setLoading(false))
  }, [orderId])

  const downloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/pdf`)
      if (!res.ok) { showToast('Could not generate PDF. Please try again.', 'error'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `order-${orderId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('Could not generate PDF. Please try again.', 'error')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const reorder = async () => {
    if (!order) return
    setReordering(true)
    try {
      for (const line of order.lines) {
        await fetch('/api/cart/lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: line.template_id, packaging_id: line.packaging_id, packaging_qty: line.packaging_qty }),
        })
      }
      await fetchCart()
      showToast(`${order.lines.length} item${order.lines.length !== 1 ? 's' : ''} added to cart`)
      router.push('/cart')
    } catch {
      showToast('Could not reorder. Please try again.', 'error')
    } finally {
      setReordering(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (notFound || !order) return <EmptyState title="Order not found" action={<Button onClick={() => router.back()} variant="secondary">Go back</Button>} />

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-brand-700 hover:underline mb-6">
        <ChevronLeft className="h-4 w-4" /> {t(lang, 'orders.title')}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">{order.name}</h1>
          <p className="text-sm text-gray-400">{formatDate(order.date_order, lang)} · {order.state_label}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={downloadPdf} loading={downloadingPdf}>
            <Download className="h-4 w-4 me-1" /> {t(lang, 'orders.downloadPdf')}
          </Button>
          <Button variant="ghost" size="sm" onClick={reorder} loading={reordering}>
            <RefreshCw className="h-4 w-4 me-1" /> {t(lang, 'orders.reorder')}
          </Button>
        </div>
      </div>

      {/* Delivery */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{t(lang, 'checkout.deliveryAddress')}</p>
        <p className="text-sm font-medium text-gray-900">{order.partner_shipping.name}</p>
        <p className="text-sm text-gray-500 line-clamp-2">{order.partner_shipping.street}, {order.partner_shipping.city}</p>
        {(order.commitment_date || order.client_order_ref) && (
          <div className="mt-3 pt-3 border-t border-gray-50 flex flex-wrap gap-x-8 gap-y-1 text-sm">
            {order.commitment_date && (
              <span className="text-gray-500">{t(lang, 'checkout.deliveryDate')}: <span className="text-gray-900 font-medium">{formatDate(order.commitment_date, lang)}</span></span>
            )}
            {order.client_order_ref && (
              <span className="text-gray-500">{t(lang, 'checkout.poRef')}: <span className="text-gray-900 font-medium">{order.client_order_ref}</span></span>
            )}
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{t(lang, 'orders.items')}</p>
        {order.lines.map((line) => (
          <div key={line.line_id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Package className="h-8 w-8 text-gray-200 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 line-clamp-2">{lang === 'he' ? line.product_name_he : line.product_name}</p>
                <p className="text-xs text-gray-400 truncate">{line.sku} · {line.packaging_name} × {line.packaging_qty}</p>
              </div>
            </div>
            <div className="text-end">
              <p className="text-sm font-semibold">{formatCurrency(line.price_total, order.currency)}</p>
              <p className="text-xs text-gray-400">{formatCurrency(line.price_unit, order.currency)}/unit</p>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>{t(lang, 'cart.subtotal')}</span><span>{formatCurrency(order.amount_untaxed, order.currency)}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>{t(lang, 'cart.tax')}</span><span>{formatCurrency(order.amount_tax, order.currency)}</span>
        </div>
        <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-2">
          <span>{t(lang, 'cart.total')}</span><span>{formatCurrency(order.amount_total, order.currency)}</span>
        </div>
      </div>

      {order.note && (
        <div className="mt-4 bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{t(lang, 'checkout.orderNote')}</p>
          <p className="text-sm text-gray-600">{order.note}</p>
        </div>
      )}
    </div>
  )
}
