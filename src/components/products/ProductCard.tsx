'use client'
import { Product } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency, computeMaxPacks } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import Link from 'next/link'
import Image from 'next/image'
import { ShoppingCart, Package } from 'lucide-react'
import { useState } from 'react'
import { FavoriteButton } from './FavoriteButton'
import { QuantitySelector } from './QuantitySelector'
import { Button } from '@/components/ui/Button'
import { useCartStore } from '@/store/cartStore'
import { useToastStore } from '@/store/toastStore'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'

interface ProductCardProps {
  product: Product
  favorited?: boolean
}

export function ProductCard({ product, favorited = false }: ProductCardProps) {
  const { lang } = useLangStore()
  const addToCartAndSync = useCartStore((s) => s.addToCartAndSync)
  const showToast = useToastStore((s) => s.show)
  const lowStockThreshold = useSiteSettingsStore((s) => s.settings.lowStockThreshold)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [imgError, setImgError] = useState(false)

  const name = lang === 'he' ? product.name_he : product.name
  const defaultPkg = product.packaging_options.find((p) => p.is_default) ?? product.packaging_options[0]
  const price = defaultPkg?.price_per_pack_incl_tax ?? 0
  const unitPrice = defaultPkg?.price_per_unit_incl_tax ?? 0
  // Defense-in-depth UX cap — the server always re-validates on add. undefined = unlimited.
  const maxPacks = defaultPkg ? computeMaxPacks(product.in_stock, product.qty_available, defaultPkg.qty) : undefined
  const soldOut = maxPacks === 0

  const addToCart = () => {
    if (!defaultPkg) return
    // Optimistic update + background sync + sequenced reconcile, shared with the
    // product detail page via the cart store.
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
    showToast(`${name} added to cart`)
    addToCartAndSync(product, defaultPkg, qty).then((result) => {
      if (!result.ok) showToast(result.message ?? 'Could not add to cart. Please try again.', 'error')
    })
  }

  return (
    <div className="group flex flex-col rounded-2xl border border-gray-100 bg-white hover:border-brand-200 hover:shadow-md transition-all duration-200 overflow-hidden">
      {/* Image area */}
      <Link href={`/products/${product.id}`} className="relative aspect-square bg-gray-50 overflow-hidden">
        {!imgError ? (
          <Image
            src={product.image_url}
            alt={name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="h-16 w-16 text-gray-200" />
          </div>
        )}

        {/* Out of stock overlay */}
        {!product.sellable && (
          <div className="absolute inset-0 bg-white/75 flex items-center justify-center">
            <span className="text-xs font-semibold text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
              {t(lang, 'products.outOfStock')}
            </span>
          </div>
        )}

        {/* Low stock badge */}
        {product.sellable && product.qty_available > 0 && product.qty_available < lowStockThreshold && (
          <div className="absolute top-2 start-2">
            <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              {t(lang, 'products.lowStock')}
            </span>
          </div>
        )}

        {/* Favorite button */}
        <div className="absolute top-2 end-2">
          <FavoriteButton templateId={product.template_id} initialFavorited={favorited} />
        </div>
      </Link>

      {/* Details */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        <div className="flex-1">
          <Link
            href={`/products/${product.id}`}
            className="block text-sm font-semibold text-gray-900 leading-snug hover:text-brand-700 line-clamp-2 transition-colors"
          >
            {name}
          </Link>
          {product.sku && (
            <p className="text-xs text-gray-400 mt-1 font-mono">{product.sku}</p>
          )}
        </div>

        {defaultPkg && (
          <div className="space-y-1 text-xs">
            {/* flex-wrap + gap: in the narrow 2-col mobile grid the pack label
                and price were interleaving; now the price wraps to its own line. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-gray-500 truncate min-w-0">{defaultPkg.name}</span>
              <span className="font-bold text-gray-900 text-sm whitespace-nowrap ms-auto">{formatCurrency(price, product.currency)}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-gray-400">
              <span className="truncate min-w-0">{t(lang, 'products.unitPrice')}</span>
              <span className="whitespace-nowrap ms-auto">{formatCurrency(unitPrice, product.currency)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <QuantitySelector value={qty} onChange={setQty} size="sm" className="flex-1" max={maxPacks && maxPacks > 0 ? maxPacks : undefined} />
          <Button
            size="sm"
            onClick={addToCart}
            disabled={!product.sellable || soldOut}
            className="shrink-0 min-w-[40px]"
          >
            {added
              ? <span className="text-xs font-bold">✓</span>
              : <ShoppingCart className="h-4 w-4" />
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
