'use client'
import { useEffect, useState, useCallback } from 'react'
import { Product } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { ProductCard } from '@/components/products/ProductCard'
import { ProductCardSkeleton } from '@/components/ui/LoadingSpinner'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { TrendingUp, ArrowLeft, Package } from 'lucide-react'
import Link from 'next/link'

export default function BestSellersPage() {
  const { lang } = useLangStore()
  const [products, setProducts] = useState<Product[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setOdooError(false)
    try {
      const res = await fetch(`/api/best-sellers?lang=${lang}&limit=48`)
      if (res.status === 503) { setOdooError(true); return }
      const data = await res.json()
      setProducts(data.products ?? [])
    } catch { setOdooError(true) }
    finally { setLoading(false) }
  }, [lang])

  useEffect(() => { load() }, [load])

  // Heart-icon state (best-effort; ids only).
  useEffect(() => {
    fetch('/api/favorites')
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((d) => setFavoriteIds(new Set((d.favorites ?? []).map((p: { template_id: number }) => p.template_id))))
      .catch(() => {})
  }, [])

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
          <TrendingUp className="h-4 w-4 text-brand-700" />
          <h1 className="text-lg font-bold text-brand-700">{t(lang, 'bestSellers.title')}</h1>
        </div>
        {!loading && (
          <span className="text-sm text-gray-400 ms-auto">{products.length} {products.length === 1 ? 'product' : 'products'}</span>
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
          <p className="text-gray-500 font-medium">{t(lang, 'products.noResults')}</p>
          <Link
            href="/products"
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t(lang, 'products.title')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => <ProductCard key={p.id} product={p} favorited={favoriteIds.has(p.template_id)} />)}
        </div>
      )}
    </div>
  )
}
