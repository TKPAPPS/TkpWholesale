'use client'
import { useEffect, useState } from 'react'
import { Invoice } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency, formatDate } from '@/lib/utils'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { FileText, Download, AlertCircle, Eye } from 'lucide-react'
import Link from 'next/link'
import { useToastStore } from '@/store/toastStore'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'

type Filter = 'all' | 'unpaid' | 'paid'

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

export default function InvoicesPage() {
  const { lang } = useLangStore()
  const showToast = useToastStore((s) => s.show)
  const PER_PAGE = useSiteSettingsStore((s) => s.settings.invoicesPerPage)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [totalOutstanding, setTotalOutstanding] = useState(0)
  const [currency, setCurrency] = useState('THB')
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<number | null>(null)

  const fetchInvoices = async (p = page, f = filter) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/invoices?page=${p}&filter=${f}`)
      const data = await res.json()
      setInvoices(data.invoices ?? [])
      setTotal(data.total ?? 0)
      setTotalOutstanding(data.total_outstanding ?? 0)
      setCurrency(data.currency ?? 'THB')
    } catch {
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchInvoices() }, [page, PER_PAGE])

  const applyFilter = (f: Filter) => {
    setFilter(f)
    setPage(0)
    fetchInvoices(0, f)
  }

  const downloadPdf = async (invoice: Invoice) => {
    setDownloading(invoice.id)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/pdf`)
      if (!res.ok) { showToast('Could not generate PDF. Please try again.', 'error'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${invoice.name}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('Could not generate PDF. Please try again.', 'error')
    } finally {
      setDownloading(null)
    }
  }

  const FILTERS: { key: Filter; label: Parameters<typeof t>[1] }[] = [
    { key: 'all', label: 'invoices.filterAll' },
    { key: 'unpaid', label: 'invoices.filterUnpaid' },
    { key: 'paid', label: 'invoices.filterPaid' },
  ]

  const hasOverdue = invoices.some((i) => i.state_label === 'Overdue')

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <h1 className="text-xl font-bold text-gray-900">{t(lang, 'invoices.title')}</h1>
        {totalOutstanding > 0 && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium ${hasOverdue ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            {hasOverdue && <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{t(lang, 'invoices.totalOutstanding')}: {formatCurrency(totalOutstanding, currency)}</span>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => applyFilter(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filter === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t(lang, label)}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : invoices.length === 0 ? (
        <EmptyState icon={<FileText className="h-12 w-12" />} title={t(lang, 'invoices.noInvoices')} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-100 overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="text-start px-4 py-3">{t(lang, 'invoices.title')}</th>
                  <th className="text-start px-4 py-3">{t(lang, 'orders.dateFrom')}</th>
                  <th className="text-start px-4 py-3">{t(lang, 'invoices.dueDate')}</th>
                  <th className="text-end px-4 py-3">{t(lang, 'cart.total')}</th>
                  <th className="text-end px-4 py-3">{t(lang, 'invoices.outstanding')}</th>
                  <th className="text-center px-4 py-3">{t(lang, 'orders.lines')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{inv.name}</p>
                        <PaymentBadge state={inv.payment_state} label={inv.state_label} lang={lang} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(inv.invoice_date, lang)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {inv.invoice_date_due ? formatDate(inv.invoice_date_due, lang) : '-'}
                    </td>
                    <td className="px-4 py-3 text-end font-medium text-gray-900">
                      {formatCurrency(inv.amount_total, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className={inv.amount_residual > 0 ? 'font-semibold text-amber-700' : 'text-gray-400'}>
                        {inv.amount_residual > 0 ? formatCurrency(inv.amount_residual, inv.currency) : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">{inv.line_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 font-medium transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {t(lang, 'invoices.view')}
                        </Link>
                        <button
                          onClick={() => downloadPdf(inv)}
                          disabled={downloading === inv.id}
                          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {downloading === inv.id ? '…' : t(lang, 'invoices.downloadPdf')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3 mb-4">
            {invoices.map((inv) => (
              <div key={inv.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{inv.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(inv.invoice_date, lang)}</p>
                  </div>
                  <PaymentBadge state={inv.payment_state} label={inv.state_label} lang={lang} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm mt-3">
                  <div>
                    <p className="text-xs text-gray-400">{t(lang, 'cart.total')}</p>
                    <p className="font-semibold text-gray-900">{formatCurrency(inv.amount_total, inv.currency)}</p>
                  </div>
                  {inv.amount_residual > 0 && (
                    <div className="text-end">
                      <p className="text-xs text-gray-400">{t(lang, 'invoices.outstanding')}</p>
                      <p className="font-semibold text-amber-700">{formatCurrency(inv.amount_residual, inv.currency)}</p>
                    </div>
                  )}
                  {inv.invoice_date_due && (
                    <div className="text-end">
                      <p className="text-xs text-gray-400">{t(lang, 'invoices.dueDate')}</p>
                      <p className="text-sm text-gray-700">{formatDate(inv.invoice_date_due, lang)}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-2">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 font-medium px-3 py-2 -ms-3 min-h-[44px] rounded-lg"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {t(lang, 'invoices.view')}
                  </Link>
                  <button
                    onClick={() => downloadPdf(inv)}
                    disabled={downloading === inv.id}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50 px-3 py-2 min-h-[44px] rounded-lg"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloading === inv.id ? '…' : t(lang, 'invoices.downloadPdf')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Pagination page={page} total={total} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  )
}
