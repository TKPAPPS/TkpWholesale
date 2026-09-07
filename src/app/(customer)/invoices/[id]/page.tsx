'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { InvoiceDetail, InvoiceParty } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Logo } from '@/components/layout/Logo'
import { useToastStore } from '@/store/toastStore'
import { ChevronLeft, Download, Printer } from 'lucide-react'

// Days between a due date and today, in whole days. Positive = overdue.
// Compared on calendar dates so an invoice due today never reads as overdue.
function daysOverdue(due: string | null): number {
  if (!due) return 0
  // Odoo sends a plain calendar date ("2026-08-11"). `new Date(that)` parses it as UTC
  // midnight, so reading it back with LOCAL getters shifts it a day earlier for any viewer
  // west of UTC - an invoice due today would print "Overdue by 1 day". Parse the parts
  // directly instead, and take today's date from local getters, so both sides are plain
  // calendar dates in the viewer's own timezone.
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return 0
  const a = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.floor((b - a) / 86400000)
}

// Address lines, skipping whatever Odoo left empty. Joining blindly produces stray
// commas (", Bangkok") when a street is missing.
function addressLines(p: InvoiceParty): string[] {
  const cityLine = [p.zip, p.city, p.state].filter(Boolean).join(' ')
  return [p.street, p.street2, cityLine, p.country].filter(Boolean)
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

  // Georgia (font-serif) carries no Hebrew glyphs, so the display face is English-only.
  // Money is unaffected: formatCurrency always renders Latin numerals (en-US).
  const display = lang === 'he' ? '' : 'font-serif'
  const paid = invoice.payment_state === 'paid' || invoice.amount_residual <= 0
  const late = !paid && daysOverdue(invoice.invoice_date_due) > 0
  const overdueDays = daysOverdue(invoice.invoice_date_due)

  const dueLabel = paid
    ? t(lang, 'invoices.paidInFull')
    : late
      ? t(lang, 'invoices.overdueByDays').replace('{n}', String(overdueDays))
      : overdueDays === 0 && invoice.invoice_date_due
        ? t(lang, 'invoices.dueToday')
        : invoice.invoice_date_due
          ? `${t(lang, 'invoices.dueDate')} ${formatDate(invoice.invoice_date_due, lang)}`
          : ''

  const money = (n: number) => formatCurrency(n, invoice.currency)

  return (
    <div className="max-w-3xl mx-auto">
      {/* Screen-only controls. The sheet below is what prints. */}
      {/* Back link on its own row on phones. Side by side, the back link plus both buttons
          need ~320px of a 324px budget, so the pair wrapped raggedly under the link. Stacking
          also leaves room for full-size (44px) tap targets on the two actions. */}
      <div className="flex flex-col gap-3 mb-6 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-1 self-start text-sm text-brand-700 hover:underline py-2 -my-2">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t(lang, 'invoices.title')}
        </button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t(lang, 'invoices.print')}
          </Button>
          <Button variant="secondary" onClick={downloadPdf} loading={downloadingPdf}>
            <Download className="h-4 w-4" /> {t(lang, 'invoices.downloadPdf')}
          </Button>
        </div>
      </div>

      {/* The document sheet */}
      <article className="bg-white rounded-xl border border-gray-100 print:border-0 print:rounded-none">

        {/* Masthead: issuer on the start side, document identity on the end side */}
        <header className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              {/* Group invoices are issued by several companies; only stamp the Kosher Place
                  wordmark when the issuer actually is that company. Otherwise the issuer's
                  own name carries the masthead. */}
              {invoice.is_website_company && <Logo className="h-10 w-auto mb-3" />}
              {invoice.company && (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{t(lang, 'invoices.issuedBy')}</p>
                  <p className={`text-base font-semibold text-brand-700 ${display}`}>{invoice.company.name}</p>
                  <div className="mt-1 text-xs text-gray-500 leading-relaxed">
                    {addressLines(invoice.company).map((l) => <p key={l}>{l}</p>)}
                    {invoice.company.vat && <p>{t(lang, 'invoices.taxId')}: {invoice.company.vat}</p>}
                    {invoice.company.phone && <p dir="ltr">{invoice.company.phone}</p>}
                  </div>
                </>
              )}
            </div>

            <div className="text-end min-w-0 sm:shrink-0">
              <p className={`text-2xl font-bold tracking-[0.2em] text-gray-900 uppercase ${display}`}>
                {t(lang, 'invoices.documentTitle')}
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums" dir="ltr">{invoice.name}</p>
              <dl className="mt-3 text-xs text-gray-500 space-y-0.5">
                <div className="flex justify-end gap-2">
                  <dt>{t(lang, 'invoices.invoiceDate')}</dt>
                  <dd className="text-gray-900 font-medium">{formatDate(invoice.invoice_date, lang)}</dd>
                </div>
                {invoice.invoice_date_due && (
                  <div className="flex justify-end gap-2">
                    <dt>{t(lang, 'invoices.dueDate')}</dt>
                    <dd className="text-gray-900 font-medium">{formatDate(invoice.invoice_date_due, lang)}</dd>
                  </div>
                )}
                {invoice.invoice_origin && (
                  <div className="flex justify-end gap-2">
                    <dt>{t(lang, 'invoices.orderRef')}</dt>
                    <dd className="text-gray-900 font-medium" dir="ltr">{invoice.invoice_origin}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </header>

        {/* The one ceremonial accent, used once */}
        <div className="h-px bg-gold/40" />

        {/* Bill to + the signature amount-due panel */}
        <section className="p-6 sm:p-8 grid gap-6 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{t(lang, 'invoices.billTo')}</p>
            {invoice.bill_to ? (
              <>
                <p className="text-sm font-semibold text-gray-900">{invoice.bill_to.name}</p>
                <div className="mt-1 text-sm text-gray-500 leading-relaxed">
                  {addressLines(invoice.bill_to).map((l) => <p key={l}>{l}</p>)}
                  {invoice.bill_to.vat && <p>{t(lang, 'invoices.taxId')}: {invoice.bill_to.vat}</p>}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400">-</p>
            )}
          </div>

          <div className="sm:text-end">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{t(lang, 'invoices.amountDue')}</p>
            <p className={`text-2xl sm:text-4xl font-bold tabular-nums ${display} ${paid ? 'text-gray-400' : 'text-brand-700'}`} dir="ltr">
              {money(paid ? 0 : invoice.amount_residual)}
            </p>
            {dueLabel && (
              <p className={`mt-1 text-xs font-medium ${late ? 'text-red-600' : paid ? 'text-gray-500' : 'text-gray-500'}`}>
                {dueLabel}
              </p>
            )}
            {paid && <div className="mt-3 h-px w-16 bg-gold sm:ms-auto" />}
          </div>
        </section>

        {/* Line items: real table on sm+, stacked cards below (house convention) */}
        <section className="px-6 sm:px-8">
          <div className="hidden sm:block overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0 print:overflow-visible">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-start px-3 py-2.5">{t(lang, 'invoices.description')}</th>
                <th className="text-end px-3 py-2.5 w-20">{t(lang, 'invoices.qty')}</th>
                <th className="text-end px-3 py-2.5 w-32">{t(lang, 'invoices.unitPrice')}</th>
                <th className="text-end px-3 py-2.5 w-32">{t(lang, 'invoices.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoice.lines.map((line) => (
                <tr key={line.line_id} className="break-inside-avoid">
                  <td className="px-3 py-2.5 align-top">
                    <p className="text-gray-900">{line.name}</p>
                    {line.sku && <p className="text-[11px] text-gray-400 font-mono mt-0.5" dir="ltr">{line.sku}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-end align-top text-gray-600 tabular-nums" dir="ltr">
                    {line.quantity}{line.uom && <span className="text-gray-400"> {line.uom}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-end align-top text-gray-600 tabular-nums" dir="ltr">{money(line.price_unit_net)}</td>
                  <td className="px-3 py-2.5 text-end align-top font-medium text-gray-900 tabular-nums" dir="ltr">{money(line.price_subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="sm:hidden border-t border-gray-100">
            {invoice.lines.map((line) => (
              <div key={line.line_id} className="py-3 border-b border-gray-50 last:border-0">
                <div className="flex justify-between gap-3">
                  <p className="text-sm text-gray-900 min-w-0">{line.name}</p>
                  <p className="text-sm font-medium text-gray-900 tabular-nums shrink-0" dir="ltr">{money(line.price_subtotal)}</p>
                </div>
                <p className="text-xs text-gray-400 mt-0.5" dir="ltr">
                  {line.sku && <span className="font-mono">{line.sku} · </span>}
                  {line.quantity}{line.uom ? ` ${line.uom}` : ''} × {money(line.price_unit_net)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Totals, aligned to the end edge like a printed invoice */}
        <section className="p-6 sm:p-8 pt-4 sm:pt-6">
          <div className="sm:w-72 sm:ms-auto space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">{t(lang, 'cart.subtotal')}</span>
              <span className="text-gray-900 tabular-nums" dir="ltr">{money(invoice.amount_untaxed)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">{t(lang, 'cart.tax')}</span>
              <span className="text-gray-900 tabular-nums" dir="ltr">{money(invoice.amount_tax)}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 mt-2">
              <span className="font-semibold text-gray-900">{t(lang, 'cart.total')}</span>
              <span className={`text-lg font-bold text-brand-700 tabular-nums ${display}`} dir="ltr">{money(invoice.amount_total)}</span>
            </div>
            {!paid && invoice.amount_residual !== invoice.amount_total && (
              <div className="flex justify-between gap-4 text-xs pt-1">
                <span className="text-gray-500">{t(lang, 'invoices.outstanding')}</span>
                <span className="font-semibold text-gray-900 tabular-nums" dir="ltr">{money(invoice.amount_residual)}</span>
              </div>
            )}
          </div>
        </section>

        {/* Footer: terms, reference, notes. Only rendered when Odoo has something to say. */}
        {(invoice.payment_term || invoice.reference || invoice.note) && (
          <footer className="border-t border-gray-100 p-6 sm:p-8 grid gap-4 sm:grid-cols-2 text-xs">
            {(invoice.payment_term || invoice.reference) && (
              <dl className="space-y-1">
                {invoice.payment_term && (
                  <div className="flex gap-2">
                    <dt className="text-gray-400">{t(lang, 'invoices.paymentTerms')}</dt>
                    <dd className="text-gray-700 font-medium">{invoice.payment_term}</dd>
                  </div>
                )}
                {invoice.reference && (
                  <div className="flex gap-2">
                    <dt className="text-gray-400">{t(lang, 'invoices.reference')}</dt>
                    <dd className="text-gray-700 font-medium" dir="ltr">{invoice.reference}</dd>
                  </div>
                )}
              </dl>
            )}
            {invoice.note && (
              <div className="min-w-0">
                <p className="text-gray-400 mb-1">{t(lang, 'invoices.notes')}</p>
                <p className="text-gray-600 whitespace-pre-line">{invoice.note}</p>
              </div>
            )}
          </footer>
        )}
      </article>
    </div>
  )
}
