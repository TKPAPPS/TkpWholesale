'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToastStore } from '@/store/toastStore'
import { Star, Search, Plus, X, ArrowUp, ArrowDown, Save, RotateCw } from 'lucide-react'

interface ProductRef { id: number; name: string; sku: string }

export default function FeaturedPage() {
  const router = useRouter()
  const showToast = useToastStore((s) => s.show)

  const [featured, setFeatured] = useState<ProductRef[]>([])
  const [saved, setSaved] = useState<ProductRef[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductRef[]>([])
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/featured')
      if (res.status === 401) { router.replace('/admin/login'); return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setFeatured(data.featured ?? [])
      setSaved(data.featured ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  const runSearch = (q: string) => {
    setQuery(q)
    if (debounce.current) clearTimeout(debounce.current)
    if (!q.trim()) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/product-search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.results ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const add = (p: ProductRef) => {
    if (featured.some((f) => f.id === p.id)) { showToast('Already featured', 'error'); return }
    setFeatured((prev) => [...prev, p])
  }
  const remove = (id: number) => setFeatured((prev) => prev.filter((f) => f.id !== id))
  const move = (i: number, dir: -1 | 1) => {
    setFeatured((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const dirty = JSON.stringify(featured.map((f) => f.id)) !== JSON.stringify(saved.map((f) => f.id))

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/featured', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: featured.map((f) => f.id) }),
      })
      if (res.status === 401) { router.replace('/admin/login'); return }
      if (!res.ok) throw new Error()
      setSaved(featured)
      showToast('Featured products saved')
    } catch {
      showToast('Could not save. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <Star className="h-5 w-5 text-brand-700" />
        <h1 className="text-xl font-bold text-gray-900">Featured products</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6">Curate the products shown in the &quot;Featured&quot; strip on the storefront. Order matters.</p>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {loadError && (
        <button onClick={load} className="inline-flex items-center gap-2 text-sm text-brand-700 hover:underline mb-4">
          <RotateCw className="h-4 w-4" /> Retry
        </button>
      )}

      {!loading && !loadError && (
        <div className="space-y-6">
          {/* Search to add */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="Search products to feature by name or SKU…"
                className="w-full rounded-lg border border-gray-200 ps-9 pe-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
              />
            </div>
            {searching && <p className="text-xs text-gray-400 mt-2">Searching…</p>}
            {results.length > 0 && (
              <ul className="mt-3 divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {results.map((p) => {
                  const already = featured.some((f) => f.id === p.id)
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">{p.name}</p>
                        {p.sku && <p className="text-xs text-gray-400 font-mono">{p.sku}</p>}
                      </div>
                      <button
                        onClick={() => add(p)}
                        disabled={already}
                        className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-lg disabled:text-gray-300 disabled:hover:bg-transparent"
                      >
                        <Plus className="h-3.5 w-3.5" /> {already ? 'Added' : 'Add'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Current featured list */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">{featured.length} featured</p>
            {featured.length === 0 ? (
              <p className="text-sm text-gray-400">No featured products yet. Search above to add some.</p>
            ) : (
              <ol className="space-y-1">
                {featured.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
                    <span className="text-xs text-gray-400 w-5 text-center shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{f.name}</p>
                      {f.sku && <p className="text-xs text-gray-400 font-mono">{f.sku}</p>}
                    </div>
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-1"><ArrowUp className="h-4 w-4" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === featured.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-1"><ArrowDown className="h-4 w-4" /></button>
                    <button onClick={() => remove(f.id)} className="text-gray-400 hover:text-red-500 p-1"><X className="h-4 w-4" /></button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save className="h-4 w-4 me-2" /> Save
            </Button>
            {dirty && !saving && (
              <button onClick={() => setFeatured(saved)} className="text-sm text-gray-400 hover:text-gray-600">Discard</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
