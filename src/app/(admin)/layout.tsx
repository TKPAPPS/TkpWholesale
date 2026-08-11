'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Settings, FileText, Activity, Tag, Star, Package, LogOut, Menu, X } from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/featured', label: 'Featured', icon: Star },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/categories', label: 'Categories', icon: Tag },
  { href: '/admin/content', label: 'Content', icon: FileText },
  { href: '/admin/health', label: 'API Health', icon: Activity },
]

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href
  return pathname.startsWith(href) && href !== '/admin'
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const handleLogout = async () => {
    setMobileOpen(false)
    await fetch('/api/admin/auth/logout', { method: 'POST' })
    router.replace('/admin/login')
  }

  if (pathname === '/admin/login') return <>{children}</>

  return (
    <div className="min-h-screen flex bg-gray-50">

      {/* Desktop sidebar - hidden below md */}
      <aside className="hidden md:flex w-48 shrink-0 bg-white border-e border-gray-200 flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Admin</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5">B2B Portal</p>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact)
            return (
              <Link
                key={href}
                href={href}
                className={cn('flex items-center gap-3 px-4 py-2.5 text-sm transition-colors', active ? 'bg-brand-50 text-brand-700 font-medium border-e-2 border-brand-700' : 'text-gray-600 hover:bg-gray-50')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="px-4 py-3 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Content column - full width on mobile, remaining width on md+ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar - hidden on md+ */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="flex items-center justify-center h-9 w-9 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-sm font-semibold text-gray-800">Admin</p>
        </header>

        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>

      {/* Mobile drawer backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity duration-200',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile drawer panel */}
      <div
        className={cn(
          'fixed top-0 start-0 h-full w-64 max-w-[85vw] bg-white z-50 md:hidden shadow-xl flex flex-col transition-transform duration-300 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Admin</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">B2B Portal</p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 text-sm transition-colors',
                  active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="px-4 py-3 border-t border-gray-100 shrink-0">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>

    </div>
  )
}
