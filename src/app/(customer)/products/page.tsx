'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Product, Category } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileCategoryDrawer, MobileCategoryButton } from '@/components/layout/MobileCategoryDrawer'
import { ProductCard } from '@/components/products/ProductCard'
import { Pagination } from '@/components/ui/Pagination'
import { LoadingSpinner, ProductCardSkeleton } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { Search, Package, Star } from 'lucide-react'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'

export default function ProductsPage() {
  const { lang } = useLangStore()
  const PER_PAGE = useSiteSettingsStore((s) => s.settings.productsPerPage)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [sort, setSort] = useState<'name' | 'price' | 'recently_ordered'>('name')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set())
  const [featured, setFeatured] = useState<Product[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/favorites').then(r => r.json()).catch(() => ({ favorites: [] })),
    ]).then(([cats, favs]) => {
      setCategories(cats.categories ?? [])
      setFavoriteIds(new Set(
        (favs.favorites ?? []).map((p: { template_id: number }) => p.template_id)
      ))
    })
  }, [])

  useEffect(() => {
    fetch(`/api/featured?lang=${lang}`)
      .then((r) => r.json())
      .then((d) => setFeatured(d.products ?? []))
      .catch(() => setFeatured([]))
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
  }, [page, sort, selectedCategory, lang, PER_PAGE])

  const doSearch = useCallback(async (q: string) => {
    setLoading(true)
    setOdooError(false)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&lang=${lang}`)
      const data = await res.json()
      setProducts(data.results ?? [])
      setTotal(data.total ?? 0)
    } catch { setOdooError(true) }
    finally { setLoading(false) }
  }, [lang])

  useEffect(() => {
    if (search.trim()) doSearch(search)
    else loadProducts()
  }, [page, sort, selectedCategory, lang, PER_PAGE])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    setPage(0)
    if (search.trim()) doSearch(search)
    else loadProducts()
  }

  const handleSearchInput = (value: string) => {
    setSearch(value)
    if (value.trim()) setSelectedCategory(null)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setPage(0)
      if (value.trim()) doSearch(value)
      else loadProducts()
    }, 400)
  }

  const handleCategorySelect = (id: number | null) => {
    setSelectedCategory(id)
    setPage(0)
    setSearch('')
  }

  return (
    <div className="flex gap-6">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar categories={categories} selectedCategoryId={selectedCategory} onSelect={handleCategorySelect} />
      </div>

      {/* Mobile category drawer */}
      <MobileCategoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        categories={categories}
        selectedCategoryId={selectedCategory}
        onSelect={handleCategorySelect}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Featured strip */}
        {featured.length > 0 && !search && page === 0 && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Star className="h-4 w-4 text-brand-700" />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">{t(lang, 'featured.title')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {featured.map((p) => <ProductCard key={p.id} product={p} favorited={favoriteIds.has(p.template_id)} />)}
            </div>
            <hr className="mt-4 border-gray-100" />
          </section>
        )}

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <MobileCategoryButton onClick={() => setDrawerOpen(true)} selectedCategoryId={selectedCategory} />
          <form onSubmit={handleSearch} className="flex-1 relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => handleSearchInput(e.target.value)}
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
            {products.map((p) => <ProductCard key={p.id} product={p} favorited={favoriteIds.has(p.template_id)} />)}
          </div>
        )}

        <Pagination page={page} total={total} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </div>
  )
}
