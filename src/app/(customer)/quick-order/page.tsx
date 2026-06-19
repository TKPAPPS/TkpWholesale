'use client'
import { useState, useCallback, useRef } from 'react'
import { Product, PackagingOption } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { useCartStore } from '@/store/cartStore'
import { useToastStore } from '@/store/toastStore'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Zap, Search, X, Plus, ShoppingCart, Trash2, ClipboardList } from 'lucide-react'
import Image from 'next/image'

interface OrderRow {
  product: Product
  pkg: PackagingOption
  qty: number
}

// Parse a pasted list into {sku, qty}. Accepts "SKU 10", "SKU,10", "SKU x 10", or "SKU" (qty 1).
// The qty is only taken when separated from the SKU (so a SKU ending in digits, e.g. DRY-0548,
// keeps its digits).
function parseList(text: string): { sku: string; qty: number }[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(.+?)(?:[\s,]+[xX*]?\s*(\d+))?\s*$/)
      if (!m) return { sku: line, qty: 1 }
      return { sku: m[1].trim(), qty: m[2] ? Math.max(1, parseInt(m[2], 10)) : 1 }
    })
    .filter(i => i.sku)
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
  const [showPaste, setShowPaste] = useState(false)
  const [listText, setListText] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
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

  // Bulk add a resolved list, merging quantities into existing rows (functional update so a
  // single paste of many SKUs doesn't clobber itself).
  const addResolved = (items: { product: Product; qty: number }[]) => {
    setRows(prev => {
      const next = [...prev]
      for (const { product, qty } of items) {
        const idx = next.findIndex(r => r.product.template_id === product.template_id)
        if (idx >= 0) {
          next[idx] = { ...next[idx], qty: next[idx].qty + qty }
        } else {
          const pkg = product.packaging_options.find(p => p.is_default) ?? product.packaging_options[0]
          if (pkg) next.push({ product, pkg, qty })
        }
      }
      return next
    })
  }

  const handleAddList = async () => {
    const items = parseList(listText)
    if (items.length === 0) return
    setBulkLoading(true)
    try {
      const res = await fetch('/api/bulk-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, lang }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.message ?? 'Could not process list.', 'error'); return }
      const matched: { product: Product; qty: number }[] = data.matched ?? []
      const unmatched: string[] = data.unmatched ?? []
      if (matched.length) {
        addResolved(matched)
        showToast(`${matched.length} ${t(lang, 'quickOrder.itemsAdded')}`)
      }
      if (unmatched.length) {
        showToast(`${t(lang, 'quickOrder.notFound')}: ${unmatched.slice(0, 6).join(', ')}${unmatched.length > 6 ? '…' : ''}`, 'error')
      }
      if (matched.length) { setListText(''); setShowPaste(false) }
    } catch {
      showToast('Could not process list.', 'error')
    } finally {
      setBulkLoading(false)
    }
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
                        onError={() => setImgErrors(prev => new Set(Array.from(prev).concat(p.template_id)))} />
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

      {/* Paste a list */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setShowPaste(v => !v)}
          className="flex items-center gap-2 text-sm text-brand-700 font-medium hover:underline"
        >
          <ClipboardList className="h-4 w-4" />
          {t(lang, 'quickOrder.pasteList')}
        </button>
        {showPaste && (
          <div className="mt-3 bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-2">{t(lang, 'quickOrder.pasteHint')}</p>
            <textarea
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              rows={5}
              placeholder={'DRY-0548 10\nFRZ-0029, 5\nDRY-2148 x 3'}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20 resize-y"
            />
            <div className="mt-3 flex justify-end">
              <Button onClick={handleAddList} loading={bulkLoading} disabled={!listText.trim()}>
                <Plus className="h-4 w-4 me-2" />
                {t(lang, 'quickOrder.addList')}
              </Button>
            </div>
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
                          onError={() => setImgErrors(prev => new Set(Array.from(prev).concat(row.product.template_id)))} />
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
