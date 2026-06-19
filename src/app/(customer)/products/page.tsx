'use client'
import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Product, Category } from '@/types'
import { cn } from '@/lib/utils'
import { useLangStore } from '@/store/langStore'
import { useCategoriesStore } from '@/store/categoriesStore'
import { t } from '@/lib/i18n/translations'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileCategoryDrawer, MobileCategoryButton } from '@/components/layout/MobileCategoryDrawer'
import { ProductCard } from '@/components/products/ProductCard'
import { Pagination } from '@/components/ui/Pagination'
import { LoadingSpinner, ProductCardSkeleton } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { Search, Package, Star, ChevronRight, TrendingUp } from 'lucide-react'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'

// Walk the category tree to the selected id, returning the ancestor path (for breadcrumbs).
function findCategoryPath(cats: Category[], id: number): Category[] {
  for (const c of cats) {
    if (c.id === id) return [c]
    const sub = findCategoryPath(c.children ?? [], id)
    if (sub.length) return [c, ...sub]
  }
  return []
}

function ProductsContent() {
  const { lang } = useLangStore()
  const PER_PAGE = useSiteSettingsStore((s) => s.settings.productsPerPage)
  const router = useRouter()
  const searchParams = useSearchParams()
  const categories = useCategoriesStore((s) => s.categories)
  // Category is driven by the URL (?category=) so it can be linked from anywhere
  // (navbar dropdown, deep links) and stays consistent.
  // Category, sort and page all live in the URL so browser back/forward restore your place
  // (returning from the cart keeps you on page 3, not page 1) and views are deep-linkable.
  const categoryParam = searchParams.get('category')
  const selectedCategory = categoryParam ? Number(categoryParam) : null
  const page = Number(searchParams.get('page') ?? 0)
  const sort = (searchParams.get('sort') ?? 'sku') as 'sku' | 'name' | 'price_asc' | 'price_desc' | 'recently_ordered'

  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [odooError, setOdooError] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set())
  const [featured, setFeatured] = useState<Product[]>([])
  const [bestSellers, setBestSellers] = useState<Product[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Update the URL (replace, so paging doesn't spam history) preserving the other params.
  // Falsy values (0 / '' / null) drop the param to keep clean default URLs.
  const setParams = useCallback((changes: Record<string, string | number | null>) => {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '' || v === 0) sp.delete(k)
      else sp.set(k, String(v))
    }
    const qs = sp.toString()
    router.replace(qs ? `/products?${qs}` : '/products', { scroll: false })
  }, [router, searchParams])
  const setPage = useCallback((p: number) => setParams({ page: p }), [setParams])
  const setSort = useCallback((s: string) => setParams({ sort: s === 'sku' ? null : s, page: null }), [setParams])

  useEffect(() => {
    fetch('/api/favorites').then(r => r.json()).catch(() => ({ favorites: [] }))
      .then((favs) => setFavoriteIds(new Set(
        (favs.favorites ?? []).map((p: { template_id: number }) => p.template_id)
      )))
  }, [])

  useEffect(() => {
    fetch(`/api/featured?lang=${lang}`)
      .then((r) => r.json())
      .then((d) => setFeatured(d.products ?? []))
      .catch(() => setFeatured([]))
  }, [lang])

  useEffect(() => {
    fetch(`/api/best-sellers?lang=${lang}`)
      .then((r) => r.json())
      .then((d) => setBestSellers(d.products ?? []))
      .catch(() => setBestSellers([]))
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
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setPage(0)
      if (value.trim()) doSearch(value)
      else loadProducts()
    }, 400)
  }

  // Category lives in the URL so it links from anywhere; clearing search shows it again.
  // Changing category resets to page 0.
  const handleCategorySelect = (id: number | null) => {
    setSearch('')
    setParams({ category: id, page: null })
  }

  const categoryPath = selectedCategory ? findCategoryPath(categories, selectedCategory) : []
  const selectedLabel = categoryPath.length
    ? (lang === 'he' ? categoryPath[categoryPath.length - 1].name_he : categoryPath[categoryPath.length - 1].name)
    : undefined

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

        {/* Best sellers strip (most-ordered products) */}
        {bestSellers.length > 0 && !search && page === 0 && !selectedCategory && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-brand-700" />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">{t(lang, 'bestSellers.title')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {bestSellers.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} favorited={favoriteIds.has(p.template_id)} />)}
            </div>
            <hr className="mt-4 border-gray-100" />
          </section>
        )}

        {/* Breadcrumb (when a category is selected and not searching) */}
        {categoryPath.length > 0 && !search && (
          <nav className="flex items-center flex-wrap gap-1 text-xs text-gray-400 mb-3">
            <button onClick={() => handleCategorySelect(null)} className="hover:text-brand-700 transition-colors">
              {t(lang, 'products.allCategories')}
            </button>
            {categoryPath.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                <button
                  onClick={() => handleCategorySelect(c.id)}
                  className={cn('hover:text-brand-700 transition-colors', i === categoryPath.length - 1 && 'text-gray-700 font-medium')}
                >
                  {lang === 'he' ? c.name_he : c.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <MobileCategoryButton onClick={() => setDrawerOpen(true)} selectedCategoryId={selectedCategory} selectedLabel={selectedLabel} />
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
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-700/30"
          >
            <option value="sku">{t(lang, 'products.sortDefault')}</option>
            <option value="name">{t(lang, 'products.sortName')}</option>
            <option value="price_asc">{t(lang, 'products.sortPriceLow')}</option>
            <option value="price_desc">{t(lang, 'products.sortPriceHigh')}</option>
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

// useSearchParams requires a Suspense boundary at the page level.
export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-gray-400">Loading…</div>}>
      <ProductsContent />
    </Suspense>
  )
}
