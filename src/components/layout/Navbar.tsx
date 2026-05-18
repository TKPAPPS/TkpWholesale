'use client'
import Link from 'next/link'
import Image from 'next/image'
import { ShoppingCart, Heart, Clock, Package, LogOut, Menu, X, Search, Zap } from 'lucide-react'
import { useState, useRef } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency } from '@/lib/utils'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Logo } from './Logo'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function Navbar() {
  const { lang } = useLangStore()
  const { user } = useAuthStore()
  const cart = useCartStore((s) => s.cart)
  const lineCount = useCartStore((s) => s.lineCount())
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openCartPreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setCartOpen(true)
  }
  const closeCartPreview = () => {
    hoverTimer.current = setTimeout(() => setCartOpen(false), 150)
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const navLinks = [
    { href: '/dashboard', label: 'Home', icon: Package },
    { href: '/products', label: t(lang, 'nav.products'), icon: Package },
    { href: '/quick-order', label: 'Quick Order', icon: Zap },
    { href: '/recently-ordered', label: t(lang, 'nav.recentlyOrdered'), icon: Clock },
    { href: '/favorites', label: t(lang, 'nav.favorites'), icon: Heart },
    { href: '/orders', label: t(lang, 'nav.orders'), icon: Package },
  ]

  return (
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

            {/* Search */}
            <Link
              href="/products"
              className="hidden md:flex items-center justify-center h-9 w-9 rounded-lg text-gray-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
            >
              <Search className="h-5 w-5" />
            </Link>

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
                      {lineCount > 0 ? `${lineCount} product${lineCount !== 1 ? 's' : ''} in cart` : 'Your cart is empty'}
                    </p>

                    {cart && cart.lines.length > 0 ? (
                      <>
                        <ul className="space-y-3 max-h-64 overflow-y-auto">
                          {cart.lines.slice(0, 6).map((line) => (
                            <li key={line.line_id} className="flex items-center gap-3">
                              <Image
                                src={line.product_image_url}
                                alt=""
                                width={40}
                                height={40}
                                className="rounded-lg object-contain bg-gray-50 shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                              />
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
                          <p className="text-xs text-gray-400 mt-2 text-center">+{cart.lines.length - 6} more items</p>
                        )}
                        <div className="border-t border-gray-100 mt-3 pt-3 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-400">Total</p>
                            <p className="text-base font-bold text-gray-900">{formatCurrency(cart.amount_total, cart.currency)}</p>
                          </div>
                          <Link
                            href="/cart"
                            onClick={() => setCartOpen(false)}
                            className="px-4 py-2 bg-brand-700 text-white text-sm font-medium rounded-lg hover:bg-brand-800 transition-colors"
                          >
                            View Cart
                          </Link>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-4">Add products to start your order.</p>
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
                  title="Sign out"
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
                  (href === '/' ? pathname === '/' : pathname.startsWith(href))
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
  )
}
