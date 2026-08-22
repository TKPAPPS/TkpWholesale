'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Product, PackagingOption } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { formatCurrency, computeMaxPacks } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { QuantitySelector } from '@/components/products/QuantitySelector'
import { FavoriteButton } from '@/components/products/FavoriteButton'
import { useCartStore } from '@/store/cartStore'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'
import { useToastStore } from '@/store/toastStore'
import { Package, ChevronLeft, ShoppingCart } from 'lucide-react'
import Image from 'next/image'

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { lang } = useLangStore()
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [selectedPkg, setSelectedPkg] = useState<PackagingOption | null>(null)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [favorited, setFavorited] = useState(false)
  const addToCartAndSync = useCartStore((s) => s.addToCartAndSync)
  const showToast = useToastStore((s) => s.show)
  const lowStockThreshold = useSiteSettingsStore((s) => s.settings.lowStockThreshold)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => { if (!r.ok) { setNotFound(true); return null } return r.json() })
      .then((d) => {
        if (!d) return
        setProduct(d)
        setSelectedPkg(d.packaging_options.find((p: PackagingOption) => p.is_default) ?? d.packaging_options[0])
        fetch('/api/favorites')
          .then((r) => r.json())
          .then((fav) => {
            const ids = new Set((fav.favorites ?? []).map((p: { template_id: number }) => p.template_id))
            setFavorited(ids.has(d.template_id))
          })
          .catch(() => {})
      })
      .finally(() => setLoading(false))
  }, [id])

  const addToCart = () => {
    if (!product || !selectedPkg) return
    // Optimistic update + background sync + sequenced reconcile (shared store action).
    // The checkmark is immediate visual feedback; the toast text waits for the real
    // outcome (it may name a reduced quantity if the server had to clamp the add).
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
    addToCartAndSync(product, selectedPkg, qty).then((result) => {
      if (!result.ok) { showToast(result.message ?? 'Could not add to cart. Please try again.', 'error'); return }
      if (result.adjustedPacks !== undefined) {
        // Sync the stepper to what was actually added - leaving the requested (rejected)
        // number in the field made the clamp look like it hadn't happened.
        setQty(result.adjustedPacks)
        showToast(t(lang, 'products.qtyAdjustedAdd').replace(/{n}/g, String(result.adjustedPacks)))
      } else {
        showToast(`${lang === 'he' ? product.name_he : product.name} added to cart`)
      }
    })
  }

  // Defense-in-depth UX cap - the server always re-validates on add. undefined = unlimited.
  // Recomputed per selected packaging, since switching packaging changes the units-per-pack
  // and therefore how many packs fit within the available stock.
  const maxPacks = product && selectedPkg ? computeMaxPacks(product.in_stock, product.qty_available, selectedPkg.qty, product.allow_out_of_stock_order) : undefined
  const soldOut = maxPacks === 0

  useEffect(() => {
    if (maxPacks !== undefined && maxPacks > 0 && qty > maxPacks) setQty(maxPacks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPkg?.id, maxPacks])

  if (loading) return <LoadingSpinner />
  if (notFound || !product) return <EmptyState title="Product not found" description="This product is not available." action={<Button onClick={() => router.back()} variant="secondary">Go back</Button>} />

  const name = lang === 'he' ? product.name_he : product.name
  const description = lang === 'he' ? product.description_he : product.description

  return (
    <div>
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-brand-700 hover:underline mb-6">
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t(lang, 'common.back')}
      </button>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Image. Height-capped on mobile so name + price + Add to Cart appear
            on first paint instead of a full-viewport photo. */}
        <div className="h-[38vh] md:h-auto md:aspect-square bg-white rounded-2xl border border-gray-100 flex items-center justify-center overflow-hidden relative">
          {!imgError ? (
            <Image
              src={`/api/images/product/${product.template_id}/1024`}
              alt={name}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-contain"
              onError={() => setImgError(true)}
              priority
            />
          ) : (
            <Package className="h-32 w-32 text-gray-200" />
          )}
        </div>

        {/* Details */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{name}</h1>
              <p className="text-sm text-gray-400 mt-0.5">{t(lang, 'products.sku')}: {product.sku}</p>
            </div>
            <FavoriteButton templateId={product.template_id} initialFavorited={favorited} />
          </div>

          {description && <p className="text-sm text-gray-600">{description}</p>}

          {/* Packaging selector */}
          {product.packaging_options.length > 1 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Packaging</p>
              <div className="flex flex-wrap gap-2">
                {product.packaging_options.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPkg(pkg)}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${selectedPkg?.id === pkg.id ? 'border-brand-700 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {pkg.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pricing */}
          {selectedPkg && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t(lang, 'products.packPrice')} ({selectedPkg.name})</span>
                <span className="font-bold text-gray-900">{formatCurrency(selectedPkg.price_per_pack_incl_tax, product.currency)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{t(lang, 'products.unitPrice')}</span>
                <span>{formatCurrency(selectedPkg.price_per_unit_incl_tax, product.currency)}</span>
              </div>
              <p className="text-xs text-gray-400">Incl. {product.tax_names.join(', ')}</p>
            </div>
          )}

          {/* Add to cart */}
          <div className="flex items-center gap-3">
            <QuantitySelector value={qty} onChange={setQty} className="w-32" max={maxPacks && maxPacks > 0 ? maxPacks : undefined} />
            <Button onClick={addToCart} disabled={!product.sellable || soldOut} size="lg" className="flex-1">
              <ShoppingCart className="h-4 w-4 me-2" />
              {added ? 'Added!' : t(lang, 'products.addToCart')}
            </Button>
          </div>

          {!product.sellable && (
            <p className="text-sm text-red-600 font-medium">{t(lang, 'products.outOfStock')}</p>
          )}
          {product.sellable && soldOut && (
            <p className="text-sm text-amber-600 font-medium">{t(lang, 'products.insufficientStock')}</p>
          )}
          {/* Same low-stock gate as the product card. Without it this fired on every product
              with a finite quantity, so a well-stocked item announced "Only 3000 available" -
              a scarcity warning where there is no scarcity. */}
          {product.sellable && !soldOut && maxPacks !== undefined && product.qty_available < lowStockThreshold && (
            <p className="text-sm text-amber-600">{t(lang, 'products.maxAvailable').replace('{n}', String(maxPacks))}</p>
          )}
        </div>
      </div>
    </div>
  )
}
