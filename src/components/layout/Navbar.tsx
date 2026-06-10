'use client'
import Link from 'next/link'
import Image from 'next/image'
import { ShoppingCart, Heart, Package, LogOut, Menu, X, Search, FileText, Sparkles } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency } from '@/lib/utils'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Logo } from './Logo'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { SearchHit } from '@/types'

function CartLineImage({ src }: { src: string }) {
  const [imgError, setImgError] = useState(false)
  if (!src || imgError) {
    return (
      <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <Package className="h-5 w-5 text-gray-300" />
      </div>
    )
  }
  return (
    <Image
      src={src}
      alt=""
      width={40}
      height={40}
      className="rounded-lg object-contain bg-gray-50 shrink-0"
      onError={() => setImgError(true)}
    />
  )
}

export function Navbar() {
  const { lang } = useLangStore()
  const { user, setUser } = useAuthStore()
  const cart = useCartStore((s) => s.cart)
  const lineCount = useCartStore((s) => s.lineCount())
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Global search
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<SearchHit[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)

  const openSearch = () => {
    setSearchOpen(true)
    setSearchQ('')
    setSearchResults([])
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQ('')
    setSearchResults([])
  }

  useEffect(() => {
    if (!searchOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSearch() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
      if (searchAbortRef.current) searchAbortRef.current.abort()
    }
  }, [])

  const handleGlobalSearch = (value: string) => {
    setSearchQ(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!value.trim()) { setSearchResults([]); return }
    searchDebounceRef.current = setTimeout(async () => {
      if (searchAbortRef.current) searchAbortRef.current.abort()
      const controller = new AbortController()
      searchAbortRef.current = controller
      setSearchLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        if (!res.ok) { setSearchResults([]); return }
        const data = await res.json()
        setSearchResults(data.results?.slice(0, 6) ?? [])
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }

  const openCartPreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setCartOpen(true)
  }
  const closeCartPreview = () => {
    hoverTimer.current = setTimeout(() => setCartOpen(false), 150)
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.push('/login')
  }

  const navLinks = [
    { href: '/products', label: t(lang, 'nav.products'), icon: Package },
    { href: '/new-arrivals', label: t(lang, 'newArrivals.title'), icon: Sparkles },
    { href: '/favorites', label: t(lang, 'nav.favorites'), icon: Heart },
    { href: '/orders', label: t(lang, 'nav.orders'), icon: Package },
    { href: '/invoices', label: t(lang, 'invoices.title'), icon: FileText },
  ]

  return (
    <>
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-[0_1px_8px_0_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-6">

            {/* Logo */}
            <Link href="/products" className="shrink-0">
              <Logo className="h-10 w-auto" />
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
              {navLinks.map(({ href, label }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                      active
                        ? 'text-brand-700 bg-brand-50'
                        : 'text-gray-500 hover:text-brand-700 hover:bg-gray-50',
                    )}
                  >
                    {label}
                  </Link>
                )
              })}
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-1">
              <LanguageSwitcher />

              {/* Search button */}
              <button
                onClick={openSearch}
                className="flex items-center justify-center h-9 w-9 rounded-lg text-gray-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                aria-label="Search"
              >
                <Search className="h-5 w-5" />
              </button>

              {/* Cart with hover preview */}
              <div
                className="relative"
                onMouseEnter={openCartPreview}
                onMouseLeave={closeCartPreview}
              >
                <Link
                  href="/cart"
                  className="relative flex items-center justify-center h-10 w-10 rounded-lg text-gray-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                >
                  <ShoppingCart className="h-5 w-5" />
                  {lineCount > 0 && (
                    <span className="absolute -top-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-700 text-[10px] font-bold text-white">
                      {lineCount > 99 ? '99+' : lineCount}
                    </span>
                  )}
                </Link>

                {/* Hover popover */}
                {cartOpen && (
                  <div
                    className="absolute end-0 top-full mt-2 w-[min(320px,calc(100vw-1rem))] bg-white rounded-2xl border border-gray-100 shadow-xl z-50"
                    onMouseEnter={openCartPreview}
                    onMouseLeave={closeCartPreview}
                  >
                    <div className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                        {lineCount > 0 ? `${lineCount} ${t(lang, 'nav.itemsInCart')}` : t(lang, 'nav.cartEmpty')}
                      </p>

                      {cart && cart.lines.length > 0 ? (
                        <>
                          <ul className="space-y-3 max-h-64 overflow-y-auto">
                            {cart.lines.slice(0, 6).map((line) => (
                              <li key={line.line_id} className="flex items-center gap-3">
                                <CartLineImage src={line.product_image_url} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {lang === 'he' ? line.product_name_he : line.product_name}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    {line.packaging_qty} × {formatCurrency(line.price_per_pack, cart.currency)}
                                  </p>
                                </div>
                                <span className="text-sm font-semibold text-gray-900 shrink-0">
                                  {formatCurrency(line.price_total, cart.currency)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {cart.lines.length > 6 && (
                            <p className="text-xs text-gray-400 mt-2 text-center">+{cart.lines.length - 6} {t(lang, 'nav.itemsInCart')}</p>
                          )}
                          <div className="border-t border-gray-100 mt-3 pt-3 flex items-center justify-between">
                            <div>
                              <p className="text-xs text-gray-400">{t(lang, 'cart.total')}</p>
                              <p className="text-base font-bold text-gray-900">{formatCurrency(cart.amount_total, cart.currency)}</p>
                            </div>
                            <Link
                              href="/cart"
                              onClick={() => setCartOpen(false)}
                              className="px-4 py-2 bg-brand-700 text-white text-sm font-medium rounded-lg hover:bg-brand-800 transition-colors"
                            >
                              {t(lang, 'nav.viewCart')}
                            </Link>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400 text-center py-4">{t(lang, 'nav.cartEmptyHint')}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User + logout */}
              {user && (
                <div className="hidden md:flex items-center gap-2 ms-2 ps-3 border-s border-gray-100">
                  <div className="flex flex-col items-end leading-none">
                    <span className="text-xs font-medium text-gray-700 max-w-[120px] truncate">{user.name}</span>
                    {user.pricelist_name && (
                      <span className="text-[10px] text-gold mt-0.5 truncate max-w-[120px]">{user.pricelist_name}</span>
                    )}
                  </div>
                  <button
                    onClick={handleLogout}
                    title={t(lang, 'nav.logout')}
                    className="flex items-center justify-center h-9 w-9 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Mobile menu button */}
              <button
                className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white">
            <div className="px-4 py-2 space-y-0.5">
              {navLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors',
                    pathname.startsWith(href)
                      ? 'text-brand-700 bg-brand-50'
                      : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </div>
            <div className="px-4 pb-3 pt-1 border-t border-gray-100 flex items-center justify-between">
              {user && <span className="text-sm text-gray-600 truncate max-w-[180px]">{user.name}</span>}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-sm text-red-600 font-medium ms-auto"
              >
                <LogOut className="h-4 w-4" />
                {t(lang, 'nav.logout')}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Global search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={closeSearch}>
          <div className="max-w-2xl mx-auto mt-16 sm:mt-20 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">

              {/* Input row */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Search className="h-5 w-5 text-gray-400 shrink-0" />
                <input
                  ref={searchInputRef}
                  value={searchQ}
                  onChange={(e) => handleGlobalSearch(e.target.value)}
                  placeholder={t(lang, 'products.search')}
                  className="flex-1 text-base text-gray-900 placeholder-gray-400 outline-none bg-transparent"
                />
                {searchLoading && (
                  <div className="h-4 w-4 border-2 border-brand-700 border-t-transparent rounded-full animate-spin shrink-0" />
                )}
                <button onClick={closeSearch} className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Results */}
              {searchResults.length > 0 && (
                <ul className="border-t border-gray-100">
                  {searchResults.map((p) => {
                    const name = lang === 'he' ? p.name_he : p.name
                    const pkg = p.packaging_options.find((o) => o.is_default) ?? p.packaging_options[0]
                    return (
                      <li key={p.id} className="border-b border-gray-50 last:border-0">
                        <Link
                          href={`/products/${p.template_id}`}
                          onClick={closeSearch}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="h-10 w-10 rounded-lg bg-gray-50 overflow-hidden shrink-0 relative">
                            <Image
                              src={p.image_url} alt="" fill className="object-contain" sizes="40px"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                            <p className="text-xs text-gray-400">{p.sku}</p>
                          </div>
                          {pkg && (
                            <p className="text-sm font-semibold text-gray-900 shrink-0">
                              {formatCurrency(pkg.price_per_pack_incl_tax, p.currency)}
                            </p>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* No results */}
              {searchQ.trim() && !searchLoading && searchResults.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8 border-t border-gray-100">
                  {t(lang, 'products.noResults')}
                </p>
              )}

              {/* Hint when empty */}
              {!searchQ.trim() && (
                <p className="text-xs text-gray-400 text-center py-4 border-t border-gray-100">
                  {lang === 'he' ? 'חפש בעברית או באנגלית' : 'Search in English or Hebrew'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
