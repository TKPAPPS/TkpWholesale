'use client'
import { useEffect, useState } from 'react'
import { useLangStore } from '@/store/langStore'
import { useCartStore } from '@/store/cartStore'
import { t } from '@/lib/i18n/translations'
import { CartItem } from '@/components/cart/CartItem'
import { CartSummary } from '@/components/cart/CartSummary'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { OdooUnavailable } from '@/components/ui/OdooUnavailable'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { ShoppingCart, Trash2 } from 'lucide-react'

export default function CartPage() {
  const { lang } = useLangStore()
  const { cart, isLoading, odooUnavailable, setCart, setLoading, setUnavailable } = useCartStore()
  const [clearing, setClearing] = useState(false)

  const fetchCart = async () => {
    setLoading(true)
    setUnavailable(false)
    try {
      const res = await fetch('/api/cart')
      if (res.status === 503) { setUnavailable(true); return }
      setCart(await res.json())
    } catch { setUnavailable(true) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchCart() }, [])

  const clearCart = async () => {
    if (!confirm('Clear your entire cart?')) return
    setClearing(true)
    await fetch('/api/cart', { method: 'DELETE' })
    setCart(null)
    setClearing(false)
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">{t(lang, 'cart.title')}</h1>
        {cart && cart.lines.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearCart} loading={clearing} className="text-red-600 hover:text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4 me-1" /> {t(lang, 'cart.clearCart')}
          </Button>
        )}
      </div>

      {odooUnavailable && <OdooUnavailable message={t(lang, 'cart.odooUnavailable')} onRetry={fetchCart} />}

      {!odooUnavailable && (!cart || cart.lines.length === 0) && (
        <EmptyState
          icon={<ShoppingCart className="h-12 w-12" />}
          title={t(lang, 'cart.empty')}
          description={t(lang, 'cart.emptyHint')}
          action={<Link href="/products"><Button>{t(lang, 'cart.browseProducts')}</Button></Link>}
        />
      )}

      {cart && cart.lines.length > 0 && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 px-4">
            {cart.warnings.length > 0 && (
              <div className="py-3 px-4 mb-2 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-700">
                {cart.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
            {cart.lines.map((line) => (
              <CartItem key={line.line_id} line={line} currency={cart.currency} />
            ))}
          </div>
          <div>
            <CartSummary cart={cart} />
          </div>
        </div>
      )}
    </div>
  )
}
