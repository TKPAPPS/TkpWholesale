'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Product, Order } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { useCartStore } from '@/store/cartStore'
import { useLangStore } from '@/store/langStore'
import { useToastStore } from '@/store/toastStore'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ProductCard } from '@/components/products/ProductCard'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { t } from '@/lib/i18n/translations'
import { Package, ClipboardList, Heart, Sparkles, ShoppingCart, RefreshCw, ChevronRight } from 'lucide-react'

const STATE_STEP: Record<string, number> = { draft: 0, sent: 1, sale: 2, done: 3 }

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const { lang } = useLangStore()
  const cart = useCartStore((s) => s.cart)
  const lineCount = useCartStore((s) => s.lineCount())
  const reorderLines = useCartStore((s) => s.reorderLines)
  const showToast = useToastStore((s) => s.show)

  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [favorites, setFavorites] = useState<Product[]>([])
  const [newArrivals, setNewArrivals] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [reordering, setReordering] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/orders?per_page=3&page=0').then(r => r.json()),
      fetch('/api/favorites').then(r => r.json()),
      fetch('/api/products?sort=new_arrivals&per_page=4&page=0&lang=' + lang).then(r => r.json()),
    ]).then(([ord, fav, arr]) => {
      setRecentOrders(ord.orders ?? [])
      setFavorites((fav.favorites ?? []).slice(0, 4))
      setNewArrivals(arr.products ?? [])
    }).finally(() => setLoading(false))
  }, [lang])

  const reorderLast = async (orderId: number) => {
    setReordering(orderId)
    try {
      const detail = await fetch(`/api/orders/${orderId}`).then(r => r.json())
      const lines = (detail.lines ?? []).map((line: { template_id: number; packaging_id: number; packaging_qty: number }) => ({
        product_id: line.template_id, packaging_id: line.packaging_id, packaging_qty: line.packaging_qty,
      }))
      const { failed } = await reorderLines(lines)
      if (failed > 0) showToast(`${failed} item${failed > 1 ? 's' : ''} could not be added to cart`, 'error')
      router.push('/cart')
    } finally {
      setReordering(null)
    }
  }

  const hour = new Date().getHours()
  const greeting = t(lang, hour < 12 ? 'common.goodMorning' : hour < 17 ? 'common.goodAfternoon' : 'common.goodEvening')
  const firstName = user?.name?.split(' ')[0] ?? ''

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-8">

      {/* Welcome header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {firstName} 👋</h1>
          <p className="text-sm text-gray-500 mt-0.5">{user?.pricelist_name && <span className="text-amber-600 font-medium">{user.pricelist_name}</span>}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/products">
            <Button size="sm">
              <Package className="h-4 w-4 me-1.5" /> {t(lang, 'nav.products')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t(lang, 'orders.title'), value: recentOrders.length > 0 ? recentOrders.length + '+' : '0', icon: ClipboardList, href: '/orders' },
          { label: t(lang, 'nav.itemsInCart'), value: String(lineCount), icon: ShoppingCart, href: '/cart' },
          { label: t(lang, 'favorites.title'), value: String(favorites.length), icon: Heart, href: '/favorites' },
          { label: t(lang, 'cart.total'), value: cart ? formatCurrency(cart.amount_total, cart.currency) : '—', icon: Package, href: '/cart' },
        ].map(({ label, value, icon: Icon, href }) => (
          <Link key={label} href={href} className="bg-white rounded-xl border border-gray-100 p-4 hover:border-brand-200 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-4 w-4 text-gray-400" />
              <p className="text-xs text-gray-400">{label}</p>
            </div>
            <p className="text-xl font-bold text-gray-900">{value}</p>
          </Link>
        ))}
      </div>

      {/* Recent orders */}
      {recentOrders.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">{t(lang, 'orders.title')}</h2>
            <Link href="/orders" className="text-xs text-brand-700 hover:underline flex items-center gap-1">
              {t(lang, 'orders.viewDetail')} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="space-y-2">
            {recentOrders.map((order) => {
              const step = STATE_STEP[order.state] ?? 0
              return (
                <div key={order.id} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{order.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${step >= 3 ? 'bg-blue-50 text-blue-700 border-blue-100' : step >= 2 ? 'bg-green-50 text-green-700 border-green-100' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                        {order.state_label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.date_order, lang)} · {order.line_count} {t(lang, 'orders.lines')}</p>
                    {/* Progress bar */}
                    <div className="flex gap-1 mt-2">
                      {[t(lang, 'orders.stepConfirmed'), t(lang, 'orders.stepProcessing'), t(lang, 'orders.stepShipped'), t(lang, 'orders.stepDelivered')].map((s, i) => (
                        <div key={s} className={`h-1 flex-1 rounded-full ${i <= step - 1 ? 'bg-brand-700' : 'bg-gray-100'}`} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(order.amount_total, order.currency)}</p>
                    <Button
                      variant="ghost" size="sm"
                      loading={reordering === order.id}
                      onClick={() => reorderLast(order.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5 me-1" /> {t(lang, 'orders.reorder')}
                    </Button>
                    <Link href={`/orders/${order.id}`}>
                      <Button variant="secondary" size="sm">
                        {t(lang, 'orders.viewDetail')} <ChevronRight className="h-3.5 w-3.5 ms-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Favourites */}
      {favorites.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-400" /> {t(lang, 'favorites.title')}
            </h2>
            <Link href="/favorites" className="text-xs text-brand-700 hover:underline flex items-center gap-1">
              {t(lang, 'orders.viewDetail')} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {favorites.map((p) => <ProductCard key={p.id} product={p} favorited />)}
          </div>
        </section>
      )}

      {/* New arrivals */}
      {newArrivals.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-700" /> {t(lang, 'newArrivals.title')}
            </h2>
            <Link href="/new-arrivals" className="text-xs text-brand-700 hover:underline flex items-center gap-1">
              {t(lang, 'orders.viewDetail')} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {newArrivals.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* No orders yet */}
      {recentOrders.length === 0 && favorites.length === 0 && (
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600 mb-4">{t(lang, 'cart.emptyHint')}</p>
          <Link href="/products"><Button>{t(lang, 'cart.browseProducts')}</Button></Link>
        </div>
      )}
    </div>
  )
}
