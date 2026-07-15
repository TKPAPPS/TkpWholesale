'use client'
import { useEffect, useState } from 'react'
import { Order } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { OrderCard } from '@/components/orders/OrderCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Pagination } from '@/components/ui/Pagination'
import { Input } from '@/components/ui/Input'
import { Search, ClipboardList } from 'lucide-react'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'

export default function OrdersPage() {
  const { lang } = useLangStore()
  const PER_PAGE = useSiteSettingsStore((s) => s.settings.ordersPerPage)
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [odooError, setOdooError] = useState(false)

  const fetchOrders = async () => {
    setLoading(true)
    setOdooError(false)
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) })
      if (search) params.set('search', search)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/orders?${params}`)
      if (!res.ok) throw new Error('orders fetch failed')
      const data = await res.json()
      setOrders(data.orders ?? [])
      setTotal(data.total ?? 0)
    } catch {
      // Network failure or Odoo 503: show the retry state, never a fake
      // "No orders" (which reads as lost order history) or a stuck spinner.
      setOdooError(true)
      setOrders([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders() }, [page, PER_PAGE])

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(0); fetchOrders() }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">{t(lang, 'orders.title')}</h1>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(lang, 'orders.search')}
            className="w-full rounded-lg border border-gray-200 bg-white ps-9 pe-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          {t(lang, 'orders.dateFrom')}
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-700/20" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          {t(lang, 'orders.dateTo')}
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-700/20" />
        </label>
        <button type="submit" className="w-full sm:w-auto h-10 px-4 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors sm:self-end">{t(lang, 'common.search')}</button>
      </form>

      {loading ? <LoadingSpinner /> : odooError ? (
        <OdooUnavailable onRetry={fetchOrders} />
      ) : orders.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-12 w-12" />} title={t(lang, 'orders.noOrders')} />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}

      <Pagination page={page} total={total} perPage={PER_PAGE} onChange={setPage} />
    </div>
  )
}
