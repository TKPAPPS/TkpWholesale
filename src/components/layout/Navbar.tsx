'use client'
import Link from 'next/link'
import { ShoppingCart, Heart, Clock, Package, LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useRouter } from 'next/navigation'

export function Navbar() {
  const { lang } = useLangStore()
  const { user } = useAuthStore()
  const lineCount = useCartStore((s) => s.lineCount())
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const navLinks = [
    { href: '/products', label: t(lang, 'nav.products'), icon: Package },
    { href: '/favorites', label: t(lang, 'nav.favorites'), icon: Heart },
    { href: '/recently-ordered', label: t(lang, 'nav.recentlyOrdered'), icon: Clock },
    { href: '/orders', label: t(lang, 'nav.orders'), icon: Package },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/products" className="shrink-0 text-lg font-bold text-brand-700">
            B2B Portal
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href} className="px-3 py-2 text-sm text-gray-600 hover:text-brand-700 hover:bg-gray-50 rounded-lg transition-colors">
                {label}
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <LanguageSwitcher />

            <Link href="/cart" className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 transition-colors">
              <ShoppingCart className="h-5 w-5 text-gray-600" />
              {lineCount > 0 && (
                <span className="absolute -top-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                  {lineCount}
                </span>
              )}
            </Link>

            {user && (
              <div className="hidden md:flex items-center gap-2 ms-1 ps-3 border-s border-gray-200">
                <span className="text-xs text-gray-500 max-w-[120px] truncate">{user.name}</span>
                <button onClick={handleLogout} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-gray-100 transition-colors">
                  <LogOut className="h-4 w-4 text-gray-500" />
                </button>
              </div>
            )}

            {/* Mobile menu button */}
            <button className="md:hidden flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-2 py-3 text-sm text-gray-700 border-b border-gray-50"
            >
              <Icon className="h-4 w-4 text-gray-400" />
              {label}
            </Link>
          ))}
          <button onClick={handleLogout} className="flex items-center gap-3 px-2 py-3 text-sm text-red-600 w-full">
            <LogOut className="h-4 w-4" />
            {t(lang, 'nav.logout')}
          </button>
        </div>
      )}
    </header>
  )
}
