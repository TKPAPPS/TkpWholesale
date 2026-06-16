'use client'
import { useState, useRef } from 'react'
import { useToastStore } from '@/store/toastStore'
import { Search, Eye, EyeOff } from 'lucide-react'

interface ProductRow { id: number; name: string; sku: string; published: boolean; hidden: boolean }

function Switch({ on, onClick, disabled, labelOn, labelOff }: { on: boolean; onClick: () => void; disabled?: boolean; labelOn: string; labelOff: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 disabled:opacity-50"
      title={on ? labelOn : labelOff}
    >
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-brand-700' : 'bg-gray-200'}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-1'}`} />
      </span>
      <span className="text-xs text-gray-500 w-16 text-start">{on ? labelOn : labelOff}</span>
    </button>
  )
}

export default function ProductsAdminPage() {
  const showToast = useToastStore((s) => s.show)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductRow[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = (q: string) => {
    setQuery(q)
    if (debounce.current) clearTimeout(debounce.current)
    if (!q.trim()) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/products?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.results ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  // Optimistically flip one field on a row, POST it, roll back on failure.
  const update = async (id: number, patch: Partial<Pick<ProductRow, 'hidden' | 'published'>>) => {
    const prev = results
    setBusyId(id)
    setResults((rows) => rows.map((r) => r.id === id ? { ...r, ...patch } : r))
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setResults(prev)
      showToast('Could not update product.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Products</h1>
      <p className="text-sm text-gray-400 mb-6">
        Search a product to show/hide it on the portal or change whether it is published. Hiding keeps it published in Odoo but removes it from this storefront.
      </p>

      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search products by name or SKU…"
            className="w-full rounded-lg border border-gray-200 ps-9 pe-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
          />
        </div>
        {searching && <p className="text-xs text-gray-400 mt-2">Searching…</p>}

        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-50">
            {results.map((p) => (
              <li key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{p.name}</p>
                  {p.sku && <p className="text-xs text-gray-400 font-mono">{p.sku}</p>}
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  <Switch
                    on={p.published}
                    disabled={busyId === p.id}
                    onClick={() => update(p.id, { published: !p.published })}
                    labelOn="Published"
                    labelOff="Unpublished"
                  />
                  <button
                    onClick={() => update(p.id, { hidden: !p.hidden })}
                    disabled={busyId === p.id}
                    className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
                    title={p.hidden ? 'Hidden on portal' : 'Visible on portal'}
                  >
                    {p.hidden
                      ? <><EyeOff className="h-4 w-4 text-gray-400" /><span className="text-gray-400 w-14 text-start">Hidden</span></>
                      : <><Eye className="h-4 w-4 text-brand-700" /><span className="text-brand-700 w-14 text-start">Visible</span></>}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {query.trim() && !searching && results.length === 0 && (
          <p className="text-sm text-gray-400 mt-3">No products found.</p>
        )}
      </div>
    </div>
  )
}
