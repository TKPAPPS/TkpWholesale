'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Package, Zap, ShoppingCart, ClipboardList } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { cn } from '@/lib/utils'

// Persistent, thumb-reachable bottom navigation for phones. Hidden on md+ where the
// top nav handles everything. Covers the most-used wholesale flows.
export function BottomNav() {
  const pathname = usePathname()
  const { lang } = useLangStore()
  const lineCount = useCartStore((s) => s.lineCount())

  const tabs = [
    { href: '/dashboard', label: t(lang, 'nav.home'), icon: Home, exact: true },
    { href: '/products', label: t(lang, 'nav.products'), icon: Package },
    { href: '/quick-order', label: t(lang, 'nav.quickOrder'), icon: Zap },
    { href: '/cart', label: t(lang, 'nav.cart'), icon: ShoppingCart, badge: lineCount },
    { href: '/orders', label: t(lang, 'nav.orders'), icon: ClipboardList },
  ]

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-100 shadow-[0_-1px_8px_0_rgba(0,0,0,0.05)] pb-[env(safe-area-inset-bottom)] print:hidden">
      <div className="grid grid-cols-5">
        {tabs.map(({ href, label, icon: Icon, exact, badge }) => {
          const active = isActive(href, exact)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                active ? 'text-brand-700' : 'text-gray-400',
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge ? (
                  <span className="absolute -top-1.5 -end-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-700 px-1 text-[9px] font-bold text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </span>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
