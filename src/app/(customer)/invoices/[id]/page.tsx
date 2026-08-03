'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { InvoiceDetail } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToastStore } from '@/store/toastStore'
import { Package, ChevronLeft, Download } from 'lucide-react'

// Compact payment-state badge (mirrors the one on the invoices list).
function PaymentBadge({ state, label, lang }: { state: string; label: string; lang: string }) {
  const map: Record<string, string> = {
    paid: 'bg-green-50 text-green-700 border-green-200',
    in_payment: 'bg-blue-50 text-blue-700 border-blue-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    overdue: 'bg-red-50 text-red-700 border-red-200',
    due: 'bg-gray-50 text-gray-500 border-gray-200',
  }
  const key = state === 'not_paid' ? (label === 'Overdue' ? 'overdue' : 'due') : state
  const i18nKey = `invoices.${key === 'overdue' ? 'overdue' : key === 'due' ? 'due' : key === 'paid' ? 'paid' : key === 'partial' ? 'partial' : 'inPayment'}` as Parameters<typeof t>[1]
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${map[key] ?? map.due}`}>
      {t(lang as 'en' | 'he', i18nKey)}
    </span>
  )
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { lang } = useLangStore()
  const router = useRouter()
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const showToast = useToastStore((s) => s.show)

  useEffect(() => {
    fetch(`/api/invoices/${id}`)
      .then((r) => { if (!r.ok) { setNotFound(true); return null } return r.json() })
      .then((d) => { if (d) setInvoice(d) })
      .finally(() => setLoading(false))
  }, [id])

  const downloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const res = await fetch(`/api/invoices/${id}/pdf`)
      if (!res.ok) { showToast('Could not generate PDF. Please try again.', 'error'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${invoice?.name ?? `invoice-${id}`}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('Could not generate PDF. Please try again.', 'error')
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (notFound || !invoice) return <EmptyState title={t(lang, 'invoices.notFound')} action={<Button onClick={() => router.back()} variant="secondary">{t(lang, 'common.back')}</Button>} />

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-brand-700 hover:underline mb-6">
        <ChevronLeft className="h-4 w-4" /> {t(lang, 'invoices.title')}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{invoice.name}</h1>
            <PaymentBadge state={invoice.payment_state} label={invoice.state_label} lang={lang} />
          </div>
          <p className="text-sm text-gray-400">{formatDate(invoice.invoice_date, lang)}</p>
        </div>
        <div className="shrink-0">
          <Button variant="secondary" size="sm" onClick={downloadPdf} loading={downloadingPdf}>
            <Download className="h-4 w-4 me-1" /> {t(lang, 'invoices.downloadPdf')}
          </Button>
        </div>
      </div>

      {/* Dates + outstanding */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <span className="text-gray-500">{t(lang, 'invoices.invoiceDate')}: <span className="text-gray-900 font-medium">{formatDate(invoice.invoice_date, lang)}</span></span>
        {invoice.invoice_date_due && (
          <span className="text-gray-500">{t(lang, 'invoices.dueDate')}: <span className="text-gray-900 font-medium">{formatDate(invoice.invoice_date_due, lang)}</span></span>
        )}
        {invoice.amount_residual > 0 && (
          <span className="text-gray-500">{t(lang, 'invoices.outstanding')}: <span className="text-amber-700 font-semibold">{formatCurrency(invoice.amount_residual, invoice.currency)}</span></span>
        )}
      </div>

      {/* Lines */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{t(lang, 'orders.items')}</p>
        {invoice.lines.map((line) => (
          <div key={line.line_id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Package className="h-8 w-8 text-gray-200 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 line-clamp-2">{line.name}</p>
                <p className="text-xs text-gray-400 truncate">{t(lang, 'invoices.qty')}: {line.quantity} · {formatCurrency(line.price_unit, invoice.currency)}/{t(lang, 'products.perUnit')}</p>
              </div>
            </div>
            <p className="text-sm font-semibold text-end">{formatCurrency(line.price_total, invoice.currency)}</p>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>{t(lang, 'cart.subtotal')}</span><span>{formatCurrency(invoice.amount_untaxed, invoice.currency)}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>{t(lang, 'cart.tax')}</span><span>{formatCurrency(invoice.amount_tax, invoice.currency)}</span>
        </div>
        <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-2">
          <span>{t(lang, 'cart.total')}</span><span>{formatCurrency(invoice.amount_total, invoice.currency)}</span>
        </div>
      </div>

      {invoice.note && (
        <div className="mt-4 bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{t(lang, 'checkout.orderNote')}</p>
          <p className="text-sm text-gray-600">{invoice.note}</p>
        </div>
      )}
    </div>
  )
}
