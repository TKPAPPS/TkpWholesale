'use client'
import { CartLine } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import Image from 'next/image'
import { QuantitySelector } from '@/components/products/QuantitySelector'
import { Trash2, Package, AlertTriangle } from 'lucide-react'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useToastStore } from '@/store/toastStore'

interface CartItemProps {
  line: CartLine
  currency: string
}

export function CartItem({ line, currency }: CartItemProps) {
  const { lang } = useLangStore()
  const updateLineQty = useCartStore((s) => s.updateLineQty)
  const removeLine = useCartStore((s) => s.removeLine)
  const showToast = useToastStore((s) => s.show)
  const [qty, setQty] = useState(line.packaging_qty)
  const [removing, setRemoving] = useState(false)
  const [imgError, setImgError] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const name = lang === 'he' ? line.product_name_he : line.product_name
  const subtitle = [line.sku, line.packaging_name].filter(Boolean).join(' · ')

  // A rejected update resyncs the store with the real (unchanged) server quantity — reflect
  // that back into the local input so it doesn't keep showing the rejected value. Depend on
  // `line` itself (not line.packaging_qty): every resync produces a fresh line object even
  // when the value is numerically unchanged from before the failed edit (e.g. reject a 50
  // when the true quantity was already 10 — packaging_qty stays 10, same as pre-edit — a
  // dependency on the primitive value would see "no change" and never fire, leaving the
  // input stuck showing the rejected 50).
  useEffect(() => { setQty(line.packaging_qty) }, [line])

  const updateQty = useCallback(
    (newQty: number) => {
      setQty(newQty)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateLineQty(line.line_id, newQty).then((result) => {
          if (!result.ok) showToast(result.message ?? 'Could not update quantity. Please try again.', 'error')
        })
      }, 500)
    },
    [line.line_id, updateLineQty, showToast],
  )

  const remove = async () => {
    setRemoving(true)
    await removeLine(line.line_id)
    setRemoving(false)
  }

  return (
    <div className="flex gap-3 py-4 border-b border-gray-100 last:border-0">
      <div className="h-14 w-14 shrink-0 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden">
        {!imgError && line.product_image_url ? (
          <Image
            src={line.product_image_url}
            alt=""
            width={56}
            height={56}
            className="object-contain rounded-lg"
            onError={() => setImgError(true)}
          />
        ) : (
          <Package className="h-7 w-7 text-gray-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 line-clamp-2 break-words">{name}</p>
        <p className="text-xs text-gray-400">{subtitle}</p>
        {line.warnings.length > 0 && (
          <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {line.warnings[0]}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <QuantitySelector value={qty} onChange={updateQty} />
          <div className="text-end">
            <p className="text-xs text-gray-400 mb-0.5">
              {formatCurrency(line.price_per_pack, currency)} / {line.packaging_name}
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {formatCurrency(line.price_total, currency)}
            </p>
          </div>
          <button onClick={remove} disabled={removing} className="text-gray-400 hover:text-red-500 transition-colors p-2 -m-1">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
