'use client'
import { Product } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import Link from 'next/link'
import Image from 'next/image'
import { ShoppingCart, Package } from 'lucide-react'
import { useState } from 'react'
import { FavoriteButton } from './FavoriteButton'
import { QuantitySelector } from './QuantitySelector'
import { Button } from '@/components/ui/Button'

interface ProductCardProps {
  product: Product
  favorited?: boolean
}

export function ProductCard({ product, favorited = false }: ProductCardProps) {
  const { lang } = useLangStore()
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)

  const name = lang === 'he' ? product.name_he : product.name
  const defaultPkg = product.packaging_options.find((p) => p.is_default) ?? product.packaging_options[0]
  const price = defaultPkg?.price_per_pack_incl_tax ?? 0
  const unitPrice = defaultPkg?.price_per_unit_incl_tax ?? 0

  const addToCart = async () => {
    if (!defaultPkg) return
    setAdding(true)
    try {
      await fetch('/api/cart/lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.variant_id, packaging_id: defaultPkg.id, packaging_qty: qty }),
      })
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-100 bg-white hover:border-brand-200 hover:shadow-sm transition-all overflow-hidden">
      {/* Image */}
      <Link href={`/products/${product.id}`} className="relative aspect-square bg-gray-50 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <Package className="h-16 w-16 text-gray-200" />
        </div>
        {!product.sellable && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-1 rounded-full border border-gray-200">
              {t(lang, 'products.outOfStock')}
            </span>
          </div>
        )}
        <div className="absolute top-2 end-2">
          <FavoriteButton templateId={product.template_id} initialFavorited={favorited} />
        </div>
      </Link>

      {/* Details */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        <div>
          <Link href={`/products/${product.id}`} className="block text-sm font-medium text-gray-900 leading-tight hover:text-brand-700 line-clamp-2">
            {name}
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">{product.sku}</p>
        </div>

        {defaultPkg && (
          <div className="text-xs text-gray-500 space-y-0.5">
            <div className="flex justify-between">
              <span>{t(lang, 'products.packPrice')} ({defaultPkg.name})</span>
              <span className="font-semibold text-gray-900">{formatCurrency(price, product.currency)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t(lang, 'products.unitPrice')}</span>
              <span>{formatCurrency(unitPrice, product.currency)}</span>
            </div>
          </div>
        )}

        <div className="mt-auto pt-2 flex items-center gap-2">
          <QuantitySelector value={qty} onChange={setQty} className="flex-1" />
          <Button
            size="sm"
            onClick={addToCart}
            loading={adding}
            disabled={!product.sellable}
            className="shrink-0"
          >
            {added ? '✓' : <ShoppingCart className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
