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
import { ChevronLeft, Download, RefreshCw, Printer } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'

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
  const reorderLines = useCartStore((s) => s.reorderLines)

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
      if (!res.ok) { showToast(t(lang, 'orders.pdfFailed'), 'error'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${order?.name ?? `order-${orderId}`}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast(t(lang, 'orders.pdfFailed'), 'error')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const reorder = async () => {
    if (!order) return
    setReordering(true)
    try {
      const lines = order.lines.map((line) => ({
        product_id: line.template_id, packaging_id: line.packaging_id, packaging_qty: line.packaging_qty,
      }))
      const { added, failed } = await reorderLines(lines)
      if (failed > 0) showToast(`${failed} item${failed !== 1 ? 's' : ''} could not be added to cart`, 'error')
      else showToast(`${added} item${added !== 1 ? 's' : ''} added to cart`)
      router.push('/cart')
    } catch {
      showToast('Could not reorder. Please try again.', 'error')
    } finally {
      setReordering(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (notFound || !order) return <EmptyState title={t(lang, 'orders.notFound')} action={<Button onClick={() => router.back()} variant="secondary">{t(lang, 'common.back')}</Button>} />

  // Georgia (font-serif) carries no Hebrew glyphs, so the display face is English only.
  // Money is unaffected: formatCurrency always renders Latin numerals.
  const display = lang === 'he' ? '' : 'font-serif'

  // Only stock-tracked, non-weighed lines can be short. Charge lines never ship and weighed
  // goods rarely match the ordered number, so neither is a shortfall.
  const isShort = (l: typeof order.lines[number]) =>
    l.deliverable && !l.weighed && l.qty_delivered < l.unit_qty
  const physical = order.lines.filter((l) => l.deliverable)
  const shortLines = order.lines.filter(isShort)
  const deliveredInFull = physical.length - shortLines.length
  // The only case where the invoiced quantity ever carried information. Measured across 8,000
  // stock-tracked lines since 1 July: 98.9% had invoiced exactly equal to delivered, and every
  // one of the remaining 1.1% was simply not yet invoiced (never partial, never over). A column
  // of numbers that repeats the one beside it, and shows a bare 0 in the one case it differs,
  // reads as "shipped but never billed". Said as a status instead, it is true and it clears
  // itself once the invoice is raised.
  const notInvoiced = (l: typeof order.lines[number]) =>
    l.deliverable && l.qty_delivered > 0 && l.qty_invoiced === 0

  const money = (n: number) => formatCurrency(n, order.currency)

  // Quantity cell, shared by the table and the stacked cards so the two can never drift.
  const qtyCell = (l: typeof order.lines[number]) => {
    if (!l.deliverable) return <span className="text-gray-300">{t(lang, 'orders.chargeLine')}</span>
    const short = isShort(l)
    return (
      <span className={short ? 'font-semibold text-brand-700' : 'text-gray-600'}>
        {l.qty_delivered}
        {l.weighed && <span className="text-gray-400"> {l.uom}</span>}
      </span>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Screen-only controls. The sheet below is what prints. */}
      <div className="flex flex-col gap-3 mb-6 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-1 self-start text-sm text-brand-700 hover:underline py-2 -my-2">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t(lang, 'orders.title')}
        </button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t(lang, 'invoices.print')}
          </Button>
          <Button variant="secondary" onClick={downloadPdf} loading={downloadingPdf}>
            <Download className="h-4 w-4" /> {t(lang, 'orders.downloadPdf')}
          </Button>
          <Button variant="ghost" onClick={reorder} loading={reordering}>
            <RefreshCw className="h-4 w-4" /> {t(lang, 'orders.reorder')}
          </Button>
        </div>
      </div>

      <article className="bg-white rounded-xl border border-gray-100 print:border-0 print:rounded-none">

        {/* Masthead */}
        <header className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <Logo className="h-10 w-auto mb-3" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t(lang, 'orders.deliverTo')}</p>
              <p className="text-base font-semibold text-gray-900 mt-1">{order.partner_shipping.name}</p>
              <div className="mt-1 text-xs text-gray-500 leading-relaxed">
                {[order.partner_shipping.street, order.partner_shipping.city, order.partner_shipping.country]
                  .filter(Boolean).map((l) => <p key={l}>{l}</p>)}
              </div>
            </div>

            <div className="text-end min-w-0 sm:shrink-0">
              <p className={`text-2xl font-bold tracking-[0.2em] text-gray-900 uppercase ${display}`}>
                {t(lang, 'orders.documentTitle')}
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums text-end" dir="ltr">{order.name}</p>
              <dl className="mt-3 text-xs text-gray-500 space-y-0.5">
                <div className="flex justify-end gap-2">
                  <dt>{t(lang, 'orders.orderDate')}</dt>
                  <dd className="text-gray-900 font-medium">{formatDate(order.date_order, lang)}</dd>
                </div>
                {order.commitment_date && (
                  <div className="flex justify-end gap-2">
                    <dt>{t(lang, 'checkout.deliveryDate')}</dt>
                    <dd className="text-gray-900 font-medium">{formatDate(order.commitment_date, lang)}</dd>
                  </div>
                )}
                {order.client_order_ref && (
                  <div className="flex justify-end gap-2">
                    <dt>{t(lang, 'checkout.poRef')}</dt>
                    <dd className="text-gray-900 font-medium">{order.client_order_ref}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </header>

        <div className="h-px bg-gold/60" />

        {/* Delivery summary. The question a customer opens this page to answer is "did I get
            everything", so it leads rather than sitting under the line items. */}
        <section className="px-6 sm:px-8 py-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{t(lang, 'orders.deliverySummary')}</p>
          {shortLines.length > 0 ? (
            <>
              <p className={`text-2xl sm:text-3xl font-bold text-brand-700 ${display}`}>
                {t(lang, 'orders.linesShort').replace('{n}', String(shortLines.length))}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {t(lang, 'orders.linesDelivered')
                  .replace('{n}', String(deliveredInFull))
                  .replace('{m}', String(physical.length))}
              </p>
            </>
          ) : (
            <>
              <p className={`text-2xl sm:text-3xl font-bold text-gray-900 ${display}`}>{order.state_label}</p>
              <p className="mt-1 text-sm text-gray-500">
                {deliveredInFull > 0 ? t(lang, 'orders.allDelivered') : t(lang, 'orders.nothingDelivered')}
              </p>
              {deliveredInFull > 0 && <div className="mt-3 h-px w-16 bg-gold" />}
            </>
          )}
        </section>

        {/* Line items: real table on sm+, stacked cards below (house convention) */}
        <section className="px-6 sm:px-8">
          <div className="hidden sm:block overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0 print:overflow-visible">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-start px-3 py-2.5">{t(lang, 'invoices.description')}</th>
                  <th className="text-end px-3 py-2.5 w-20">{t(lang, 'orders.ordered')}</th>
                  <th className="text-end px-3 py-2.5 w-24">{t(lang, 'orders.delivered')}</th>
                  <th className="text-end px-3 py-2.5 w-28">{t(lang, 'invoices.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {order.lines.map((line) => (
                  <tr key={line.line_id} className={`break-inside-avoid ${isShort(line) ? 'bg-brand-50' : ''}`}>
                    <td className="px-3 py-2.5 align-top">
                      <p className="text-gray-900">{lang === 'he' ? line.product_name_he : line.product_name}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {line.sku && <span className="font-mono" dir="ltr">{line.sku}</span>}
                        {line.sku && line.packaging_name ? ' · ' : ''}
                        {line.packaging_name}{line.packaging_qty ? ` × ${line.packaging_qty}` : ''}
                      </p>
                      {isShort(line) && (
                        <p className="mt-1 inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                          {line.qty_delivered === 0
                            ? t(lang, 'orders.notSent')
                            : t(lang, 'orders.shortBy').replace('{n}', String(Math.round((line.unit_qty - line.qty_delivered) * 1000) / 1000))}
                        </p>
                      )}
                      {line.weighed && line.deliverable && (
                        <p className="mt-1 text-[11px] text-gray-400">{t(lang, 'orders.weighed')}</p>
                      )}
                      {notInvoiced(line) && (
                        <p className="mt-1 text-[11px] text-gray-400">{t(lang, 'orders.notInvoicedYet')}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-end align-top text-gray-600 tabular-nums" dir="ltr">
                      {line.unit_qty}{line.uom && <span className="text-gray-400"> {line.uom}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-end align-top tabular-nums" dir="ltr">{qtyCell(line)}</td>
                    <td className="px-3 py-2.5 text-end align-top font-medium text-gray-900 tabular-nums" dir="ltr">{money(line.price_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked fallback below sm. Carries every column the table does. */}
          <div className="sm:hidden divide-y divide-gray-50 border-y border-gray-100">
            {order.lines.map((line) => (
              <div key={line.line_id} className={`py-3 ${isShort(line) ? 'bg-brand-50' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-gray-900 min-w-0 break-words">{lang === 'he' ? line.product_name_he : line.product_name}</p>
                  <p className="text-sm font-medium text-gray-900 tabular-nums shrink-0" dir="ltr">{money(line.price_total)}</p>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {line.sku && <span className="font-mono" dir="ltr">{line.sku}</span>}
                  {line.sku && line.packaging_name ? ' · ' : ''}
                  {line.packaging_name}{line.packaging_qty ? ` × ${line.packaging_qty}` : ''}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="text-gray-400">
                    {t(lang, 'orders.ordered')} <span className="text-gray-700 tabular-nums font-medium">{line.unit_qty}</span>
                    {line.uom && <span> {line.uom}</span>}
                  </span>
                  {/* A charge line has no delivered quantity, so it reads as a standalone label.
                      Prefixing it with "Delivered" produced "Delivered Charge". */}
                  {line.deliverable ? (
                    <span className="text-gray-400">
                      {t(lang, 'orders.delivered')} <span className="tabular-nums">{qtyCell(line)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-300">{t(lang, 'orders.chargeLine')}</span>
                  )}
                  {notInvoiced(line) && (
                    <span className="text-gray-400">{t(lang, 'orders.notInvoicedYet')}</span>
                  )}
                  {isShort(line) && (
                    <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-800">
                      {line.qty_delivered === 0
                        ? t(lang, 'orders.notSent')
                        : t(lang, 'orders.shortBy').replace('{n}', String(Math.round((line.unit_qty - line.qty_delivered) * 1000) / 1000))}
                    </span>
                  )}
                </div>
                {line.weighed && line.deliverable && (
                  <p className="mt-1 text-[11px] text-gray-400">{t(lang, 'orders.weighed')}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Totals */}
        <section className="px-6 sm:px-8 py-6">
          <div className="sm:w-72 sm:ms-auto space-y-1.5">
            <div className="flex justify-between gap-4 text-sm text-gray-500">
              <span>{t(lang, 'cart.subtotal')}</span>
              <span className="tabular-nums text-gray-700" dir="ltr">{money(order.amount_untaxed)}</span>
            </div>
            <div className="flex justify-between gap-4 text-sm text-gray-500">
              <span>{t(lang, 'cart.tax')}</span>
              <span className="tabular-nums text-gray-700" dir="ltr">{money(order.amount_tax)}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 mt-2">
              <span className="text-sm font-semibold text-gray-900">{t(lang, 'orders.orderValue')}</span>
              <span className={`text-lg font-bold text-brand-700 tabular-nums ${display}`} dir="ltr">{money(order.amount_total)}</span>
            </div>
          </div>
        </section>

        {order.note && (
          <footer className="px-6 sm:px-8 pb-6 pt-2 border-t border-gray-50">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{t(lang, 'checkout.orderNote')}</p>
            <p className="text-sm text-gray-600 break-words">{order.note}</p>
          </footer>
        )}
      </article>
    </div>
  )
}
