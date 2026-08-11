'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { cn } from '@/lib/utils'

// Small hover-intent dropdown controller (open on enter, brief close delay).
function useHoverMenu() {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return {
    open,
    onEnter: () => { if (timer.current) clearTimeout(timer.current); setOpen(true) },
    onLeave: () => { timer.current = setTimeout(() => setOpen(false), 120) },
    close: () => setOpen(false),
  }
}

const triggerCls = (active: boolean) => cn(
  'flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
  active ? 'text-brand-700 bg-brand-50' : 'text-gray-500 hover:text-brand-700 hover:bg-gray-50',
)

const itemCls = 'block px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-brand-50 hover:text-brand-700 transition-colors'
const panelCls = 'absolute start-0 top-full mt-1 bg-white rounded-2xl border border-gray-100 shadow-xl z-50 p-2'

// Desktop "Orders" dropdown - groups Orders, Reorder, Invoices to keep the bar lean.
export function NavOrders() {
  const { lang } = useLangStore()
  const pathname = usePathname()
  const m = useHoverMenu()
  const items = [
    { href: '/orders', label: t(lang, 'nav.orders') },
    { href: '/recently-ordered', label: t(lang, 'nav.recentlyOrdered') },
    { href: '/scheduled-orders', label: t(lang, 'nav.scheduledOrders') },
    { href: '/invoices', label: t(lang, 'invoices.title') },
  ]
  const active = items.some((i) => pathname.startsWith(i.href))
  return (
    <div className="relative" onMouseEnter={m.onEnter} onMouseLeave={m.onLeave}>
      <button className={triggerCls(active)}>
        {t(lang, 'nav.orders')} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {m.open && (
        <div className={cn(panelCls, 'w-48')} onMouseEnter={m.onEnter} onMouseLeave={m.onLeave}>
          {items.map((i) => (
            <Link key={i.href} href={i.href} onClick={m.close} className={itemCls}>{i.label}</Link>
          ))}
        </div>
      )}
    </div>
  )
}
