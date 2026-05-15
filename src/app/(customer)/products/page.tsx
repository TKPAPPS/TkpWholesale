'use client'
import { useEffect, useState, useCallback } from 'react'
import { Product, Category } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { Sidebar } from '@/components/layout/Sidebar'
import { ProductCard } from '@/components/products/ProductCard'
import { Pagination } from '@/components/ui/Pagination'
import { LoadingSpinner, ProductCardSkeleton } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { Input } from '@/components/ui/Input'
import { Search, Package, ChevronDown, ChevronUp, ClipboardList, Sparkles } from 'lucide-react'
import Link from 'next/link'

const PER_PAGE = 24

export default function ProductsPage() {
  const { lang } = useLangStore()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [sort, setSort] = useState<'name' | 'price' | 'recently_ordered'>('name')
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)
  const [recentlyOrdered, setRecentlyOrdered] = useState<Product[]>([])
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [newArrivals, setNewArrivals] = useState<Product[]>([])
  const [newArrivalsCollapsed, setNewArrivalsCollapsed] = useState(false)

  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
  }, [])

  useEffect(() => {
    fetch('/api/recently-ordered')
      .then((r) => r.json())
      .then((d) => setRecentlyOrdered(d.products ?? []))
  }, [])

  useEffect(() => {
    fetch('/api/products?sort=new_arrivals&per_page=4&page=0&lang=' + lang)
      .then((r) => r.json())
      .then((d) => setNewArrivals(d.products ?? []))
  }, [lang])

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setOdooError(false)
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        sort,
        lang,
      })
      if (selectedCategory) params.set('category_id', String(selectedCategory))
      const res = await fetch(`/api/products?${params}`)
      if (res.status === 503) { setOdooError(true); return }
      const data = await res.json()
      setProducts(data.products ?? [])
      setTotal(data.total ?? 0)
    } catch { setOdooError(true) }
    finally { setLoading(false) }
  }, [page, sort, selectedCategory, lang])

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) { loadProducts(); return }
    setLoading(true)
    const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&lang=${lang}`)
    const data = await res.json()
    setProducts(data.results ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [searchQuery, lang, loadProducts])

  useEffect(() => { if (searchQuery) doSearch(); else loadProducts() }, [page, sort, selectedCategory, lang])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(search)
    setPage(0)
    if (search) doSearch(); else loadProducts()
  }

  const handleCategorySelect = (id: number | null) => {
    setSelectedCategory(id)
    setPage(0)
    setSearch('')
    setSearchQuery('')
  }

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <div className="hidden lg:block">
        <Sidebar categories={categories} selectedCategoryId={selectedCategory} onSelect={handleCategorySelect} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* New Arrivals strip */}
        {newArrivals.length > 0 && !searchQuery && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setNewArrivalsCollapsed(!newArrivalsCollapsed)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
              >
                {newArrivalsCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                <span className="text-brand-700">{t(lang, 'newArrivals.title')}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-700 text-white">NEW</span>
              </button>
              <Link href="/new-arrivals" className="flex items-center gap-1.5 text-xs text-brand-700 hover:underline font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                {t(lang, 'newArrivals.title')}
              </Link>
            </div>
            {!newArrivalsCollapsed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {newArrivals.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            )}
            <hr className="mt-4 border-gray-100" />
          </section>
        )}

        {/* Recently ordered strip */}
        {recentlyOrdered.length > 0 && !searchQuery && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setRecentCollapsed(!recentCollapsed)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
              >
                {recentCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                {t(lang, 'recent.title')}
              </button>
              <Link href="/orders" className="flex items-center gap-1.5 text-xs text-brand-700 hover:underline font-medium">
                <ClipboardList className="h-3.5 w-3.5" />
                {t(lang, 'orders.title')}
              </Link>
            </div>
            {!recentCollapsed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {recentlyOrdered.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            )}
            <hr className="mt-4 border-gray-100" />
          </section>
        )}

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <form onSubmit={handleSearch} className="flex-1 relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(lang, 'products.search')}
              className="w-full rounded-lg border border-gray-200 bg-white ps-9 pe-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/30"
            />
          </form>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as typeof sort); setPage(0) }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-700/30"
          >
            <option value="name">{t(lang, 'products.sortName')}</option>
            <option value="price">{t(lang, 'products.sortPrice')}</option>
            <option value="recently_ordered">{t(lang, 'products.sortRecent')}</option>
          </select>
        </div>

        {/* Results count */}
        {!loading && <p className="text-xs text-gray-400 mb-3">{total} products</p>}

        {/* Error */}
        {odooError && <OdooUnavailable onRetry={loadProducts} />}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : products.length === 0 && !odooError ? (
          <EmptyState
            icon={<Package className="h-12 w-12" />}
            title={t(lang, 'products.noResults')}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}

        <Pagination page={page} total={total} perPage={PER_PAGE} onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
      </div>
    </div>
  )
}
