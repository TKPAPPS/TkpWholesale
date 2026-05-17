'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Settings, FileText, ScrollText, ShieldCheck, Activity, Tag, LogOut } from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/categories', label: 'Categories', icon: Tag },
  { href: '/admin/content', label: 'Content', icon: FileText },
  { href: '/admin/logs', label: 'Logs', icon: ScrollText },
  { href: '/admin/audit', label: 'Audit', icon: ShieldCheck },
  { href: '/admin/health', label: 'API Health', icon: Activity },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' })
    router.replace('/admin/login')
  }

  if (pathname === '/admin/login') return <>{children}</>

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-48 shrink-0 bg-white border-e border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Admin</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5">B2B Portal</p>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href) && href !== '/admin'
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
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  )
}
