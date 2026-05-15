'use client'
import { useEffect, useState, useCallback } from 'react'
import { Product } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { ProductCard } from '@/components/products/ProductCard'
import { Pagination } from '@/components/ui/Pagination'
import { ProductCardSkeleton } from '@/components/ui/LoadingSpinner'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { Sparkles, ArrowLeft, Package } from 'lucide-react'
import Link from 'next/link'

const PER_PAGE = 24
const DAYS = 14

function getCreatedAfter(): string {
  const d = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
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
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/products"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t(lang, 'products.title')}
        </Link>
        <span className="text-gray-300">/</span>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-700" />
          <h1 className="text-lg font-bold text-brand-700">{t(lang, 'newArrivals.title')}</h1>
        </div>
        {!loading && (
          <span className="text-sm text-gray-400 ms-auto">{total} {total === 1 ? 'product' : 'products'}</span>
        )}
      </div>

      {odooError && <OdooUnavailable onRetry={load} />}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : products.length === 0 && !odooError ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Package className="h-12 w-12 text-gray-300" />
          <p className="text-gray-500 font-medium">No new products in the past {DAYS} days.</p>
          <Link
            href="/products"
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Browse All Products
          </Link>
        </div>
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
