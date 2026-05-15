'use client'
import { useEffect, useState, useCallback } from 'react'
import { Product } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { ProductCard } from '@/components/products/ProductCard'
import { Pagination } from '@/components/ui/Pagination'
import { ProductCardSkeleton } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { Sparkles } from 'lucide-react'

const PER_PAGE = 24

function getCreatedAfter(): string {
  const d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  return d.toISOString().split('T')[0]
}

export default function NewArrivalsPage() {
  const { lang } = useLangStore()
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setOdooError(false)
    try {
      const params = new URLSearchParams({
        sort: 'new_arrivals',
        created_after: getCreatedAfter(),
        page: String(page),
        per_page: String(PER_PAGE),
        lang,
      })
      const res = await fetch(`/api/products?${params}`)
      if (res.status === 503) { setOdooError(true); return }
      const data = await res.json()
      setProducts(data.products ?? [])
      setTotal(data.total ?? 0)
    } catch { setOdooError(true) }
    finally { setLoading(false) }
  }, [page, lang])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="h-5 w-5 text-brand-700" />
        <h1 className="text-xl font-bold text-brand-700">{t(lang, 'newArrivals.title')}</h1>
        {!loading && (
          <span className="text-sm text-gray-400 ms-2">{total} products</span>
        )}
      </div>

      {odooError && <OdooUnavailable onRetry={load} />}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : products.length === 0 && !odooError ? (
        <EmptyState
          icon={<Sparkles className="h-12 w-12" />}
          title="No new arrivals in the past 14 days."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}

      <Pagination
        page={page}
        total={total}
        perPage={PER_PAGE}
        onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
      />
    </div>
  )
}
