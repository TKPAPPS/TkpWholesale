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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import Link from 'next/link'
import { ShoppingCart, Trash2 } from 'lucide-react'

export default function CartPage() {
  const { lang } = useLangStore()
  // Use the store's own sequenced fetchCart (not a separate local fetch) - a parallel,
  // unsequenced fetch here could win a race against a just-completed edit's response
  // (e.g. a server-clamped quantity) and silently overwrite it with a stale snapshot.
  const { cart, isLoading, odooUnavailable, setCart, fetchCart } = useCartStore()
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  // showLoading only here, on the page's own initial load. Background resyncs (after an
  // edit, or from the layout) must not flip the global spinner, or every quantity change
  // would blank the whole page and remount each row.
  useEffect(() => { fetchCart({ showLoading: true }) }, [])

  const clearCart = async () => {
    setClearing(true)
    await fetch('/api/cart', { method: 'DELETE' })
    setCart(null)
    setClearing(false)
    setConfirmClear(false)
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">{t(lang, 'cart.title')}</h1>
        {cart && cart.lines.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} loading={clearing} className="text-red-600 hover:text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4 me-1" /> {t(lang, 'cart.clearCart')}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={t(lang, 'cart.clearCart')}
        message={t(lang, 'cart.clearConfirm')}
        confirmLabel={t(lang, 'cart.clearCart')}
        cancelLabel={t(lang, 'common.cancel')}
        busyLabel={t(lang, 'common.working')}
        destructive
        busy={clearing}
        onConfirm={clearCart}
        onCancel={() => setConfirmClear(false)}
      />

      {odooUnavailable && <OdooUnavailable message={t(lang, 'cart.odooUnavailable')} onRetry={() => fetchCart({ showLoading: true })} />}

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
