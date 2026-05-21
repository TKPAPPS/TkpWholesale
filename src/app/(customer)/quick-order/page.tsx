'use client'
import { useState, useCallback, useRef } from 'react'
import { Product, PackagingOption } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { useCartStore } from '@/store/cartStore'
import { useToastStore } from '@/store/toastStore'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Zap, Search, X, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import Image from 'next/image'

interface OrderRow {
  product: Product
  pkg: PackagingOption
  qty: number
}

export default function QuickOrderPage() {
  const { lang } = useLangStore()
  const fetchCart = useCartStore((s) => s.fetchCart)
  const showToast = useToastStore((s) => s.show)

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [adding, setAdding] = useState(false)
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&lang=${lang}`)
      const data = await res.json()
      setSuggestions((data.results ?? []).slice(0, 8))
    } finally {
      setSearching(false)
    }
  }, [lang])

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  const addProduct = (product: Product) => {
    const existing = rows.find(r => r.product.template_id === product.template_id)
    if (existing) {
      setRows(rows.map(r => r.product.template_id === product.template_id ? { ...r, qty: r.qty + 1 } : r))
    } else {
      const pkg = product.packaging_options.find(p => p.is_default) ?? product.packaging_options[0]
      if (pkg) setRows([...rows, { product, pkg, qty: 1 }])
    }
    setQuery('')
    setSuggestions([])
  }

  const updateRow = (templateId: number, field: 'pkg' | 'qty', value: PackagingOption | number) => {
    setRows(rows.map(r => r.product.template_id === templateId ? { ...r, [field]: value } : r))
  }

  const removeRow = (templateId: number) => {
    setRows(rows.filter(r => r.product.template_id !== templateId))
  }

  const addAllToCart = async () => {
    if (rows.length === 0) return
    setAdding(true)
    try {
      for (const row of rows) {
        await fetch('/api/cart/lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: row.product.template_id, packaging_id: row.pkg.id, packaging_qty: row.qty }),
        })
      }
      await fetchCart()
      showToast(`${rows.length} item${rows.length !== 1 ? 's' : ''} added to cart`)
      setRows([])
    } catch {
      showToast('Could not add to cart. Please try again.', 'error')
    } finally {
      setAdding(false)
    }
  }

  const total = rows.reduce((sum, r) => sum + r.pkg.price_per_pack_incl_tax * r.qty, 0)
  const currency = rows[0]?.product.currency ?? 'THB'

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Zap className="h-6 w-6 text-brand-700" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t(lang, 'quickOrder.title')}</h1>
          <p className="text-sm text-gray-500">{t(lang, 'quickOrder.subtitle')}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        {searching && (
          <div className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 border-2 border-brand-700 border-t-transparent rounded-full animate-spin" />
        )}
        <input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder={t(lang, 'quickOrder.searchPlaceholder')}
          className="w-full rounded-xl border border-gray-200 bg-white ps-10 pe-10 py-3 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/30"
          autoFocus
        />
        {query && (
          <button onClick={() => { setQuery(''); setSuggestions([]) }} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Suggestions dropdown */}
        {suggestions.length > 0 && (
          <div className="absolute top-full mt-1 start-0 end-0 bg-white rounded-xl border border-gray-100 shadow-lg z-20 overflow-hidden">
            {suggestions.map((p) => {
              const name = lang === 'he' ? p.name_he : p.name
              const pkg = p.packaging_options.find(o => o.is_default) ?? p.packaging_options[0]
              return (
                <button
                  key={p.template_id}
                  onClick={() => addProduct(p)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-start border-b border-gray-50 last:border-0"
                >
                  <div className="h-10 w-10 rounded-lg bg-gray-50 overflow-hidden shrink-0 relative">
                    {!imgErrors.has(p.template_id) ? (
                      <Image src={p.image_url} alt="" fill className="object-contain" sizes="40px"
                        onError={() => setImgErrors(prev => new Set(Array.from(prev).concat(p.template_id)))}
                        unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">—</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                    <p className="text-xs text-gray-400">{p.sku} {pkg ? `· ${formatCurrency(pkg.price_per_pack_incl_tax, p.currency)} / ${pkg.name}` : ''}</p>
                  </div>
                  <Plus className="h-4 w-4 text-brand-700 shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Order table */}
      {rows.length > 0 ? (
        <>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
            {/* Header */}
            <div className="hidden sm:grid grid-cols-[1fr_160px_100px_100px_40px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span>Product</span>
              <span>Packaging</span>
              <span className="text-center">Qty</span>
              <span className="text-end">Subtotal</span>
              <span />
            </div>

            {rows.map((row) => {
              const name = lang === 'he' ? row.product.name_he : row.product.name
              const lineTotal = row.pkg.price_per_pack_incl_tax * row.qty
              return (
                <div key={row.product.template_id} className="grid grid-cols-1 sm:grid-cols-[1fr_160px_100px_100px_40px] gap-3 items-center px-4 py-3 border-b border-gray-50 last:border-0">
                  {/* Product */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-gray-50 overflow-hidden shrink-0 relative">
                      {!imgErrors.has(row.product.template_id) ? (
                        <Image src={row.product.image_url} alt="" fill className="object-contain" sizes="40px"
                          onError={() => setImgErrors(prev => new Set(Array.from(prev).concat(row.product.template_id)))}
                          unoptimized />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                      <p className="text-xs text-gray-400">{row.product.sku}</p>
                    </div>
                  </div>

                  {/* Packaging */}
                  <select
                    value={row.pkg.id}
                    onChange={(e) => {
                      const pkg = row.product.packaging_options.find(p => p.id === Number(e.target.value))
                      if (pkg) updateRow(row.product.template_id, 'pkg', pkg)
                    }}
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-700/30"
                  >
                    {row.product.packaging_options.map(p => (
                      <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price_per_pack_incl_tax, row.product.currency)}</option>
                    ))}
                  </select>

                  {/* Qty */}
                  <input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) => { const v = Math.max(1, parseInt(e.target.value) || 1); updateRow(row.product.template_id, 'qty', v) }}
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center font-medium focus:outline-none focus:ring-1 focus:ring-brand-700/30"
                  />

                  {/* Subtotal */}
                  <p className="text-sm font-semibold text-gray-900 text-end">{formatCurrency(lineTotal, row.product.currency)}</p>

                  {/* Remove */}
                  <button onClick={() => removeRow(row.product.template_id)} className="flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors ms-auto sm:ms-0">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white rounded-xl border border-gray-100 px-4 py-4">
            <div>
              <p className="text-xs text-gray-400">{rows.length} {t(lang, 'orders.lines')}</p>
              <p className="text-lg font-bold text-gray-900">{t(lang, 'cart.total')} {formatCurrency(total, currency)}</p>
              <p className="text-xs text-gray-400">{t(lang, 'quickOrder.inclTax')}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setRows([])}>{t(lang, 'quickOrder.clearAll')}</Button>
              <Button onClick={addAllToCart} loading={adding}>
                <ShoppingCart className="h-4 w-4 me-2" />
                {t(lang, 'products.addToCart')}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <Zap className="h-10 w-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm">{t(lang, 'quickOrder.emptyHint')}</p>
        </div>
      )}
    </div>
  )
}
