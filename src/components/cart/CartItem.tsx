'use client'
import { CartLine } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import { QuantitySelector } from '@/components/products/QuantitySelector'
import { Trash2, Package, AlertTriangle } from 'lucide-react'
import { useState, useCallback } from 'react'
import { useCartStore } from '@/store/cartStore'

interface CartItemProps {
  line: CartLine
  currency: string
}

export function CartItem({ line, currency }: CartItemProps) {
  const { lang } = useLangStore()
  const { setCart } = useCartStore()
  const [qty, setQty] = useState(line.packaging_qty)
  const [removing, setRemoving] = useState(false)

  const name = lang === 'he' ? line.product_name_he : line.product_name

  const updateQty = useCallback(
    async (newQty: number) => {
      setQty(newQty)
      // Debounce is handled by the caller in production
      const res = await fetch(`/api/cart/lines/${line.line_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packaging_qty: newQty }),
      })
      if (res.ok) {
        const cart = await res.json()
        setCart(cart)
      }
    },
    [line.line_id, setCart],
  )

  const remove = async () => {
    setRemoving(true)
    const res = await fetch(`/api/cart/lines/${line.line_id}`, { method: 'DELETE' })
    if (res.ok) {
      const cart = await res.json()
      setCart(cart)
    }
    setRemoving(false)
  }

  return (
    <div className="flex gap-3 py-4 border-b border-gray-100 last:border-0">
      <div className="h-14 w-14 shrink-0 rounded-lg bg-gray-50 flex items-center justify-center">
        <Package className="h-7 w-7 text-gray-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
        <p className="text-xs text-gray-400">{line.sku} · {line.packaging_name}</p>
        {line.warnings.length > 0 && (
          <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {line.warnings[0]}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <QuantitySelector value={qty} onChange={updateQty} />
          <div className="text-end">
            <p className="text-sm font-semibold text-gray-900">{formatCurrency(line.price_total, currency)}</p>
            <p className="text-xs text-gray-400">{formatCurrency(line.price_unit, currency)} / unit</p>
          </div>
          <button onClick={remove} disabled={removing} className="text-gray-400 hover:text-red-500 transition-colors p-1">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
