'use client'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { Save, RefreshCw, Globe, Tag } from 'lucide-react'

interface AdminCategory {
  id: number
  name: string
  name_he: string
  parent_id: number | null
  website_id: number | null
  website_name: string
  hidden: boolean
}

interface CategoryNode extends AdminCategory {
  children: CategoryNode[]
  orphaned: boolean   // parent exists in Odoo but is outside the wholesale website set
}

function buildTree(cats: AdminCategory[]): CategoryNode[] {
  const map = new Map<number, CategoryNode>(cats.map(c => [c.id, { ...c, children: [], orphaned: false }]))
  const roots: CategoryNode[] = []
  Array.from(map.values()).forEach(node => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      // parent_id is set but the parent isn't in the wholesale category set - it belongs
      // to another website (e.g. a J Cafe / Jdeli restaurant menu). The customer nav only
      // walks down from real top-level categories, so this one never renders there even
      // though it isn't explicitly hidden. Flag it so the admin display tells the truth.
      if (node.parent_id) node.orphaned = true
      roots.push(node)
    }
  })
  return roots
}

function CategoryRow({
  node,
  depth,
  hiddenIds,
  inheritedHidden,
  onToggle,
  onToggleSubtree,
}: {
  node: CategoryNode
  depth: number
  hiddenIds: Set<number>
  inheritedHidden: boolean
  onToggle: (id: number) => void
  onToggleSubtree: (node: CategoryNode, hide: boolean) => void
}) {
  const ownHidden = hiddenIds.has(node.id)
  // A category is effectively hidden if it or any ancestor is hidden, OR it is orphaned
  // (parent outside the wholesale site) so it can never render in the customer nav.
  const effectiveHidden = inheritedHidden || ownHidden || node.orphaned
  const cannotShow = inheritedHidden || node.orphaned   // toggling won't make it appear
  const hasChildren = node.children.length > 0

  const allChildrenHidden = hasChildren && node.children.every(c => hiddenIds.has(c.id))
  const someChildrenHidden = hasChildren && node.children.some(c => hiddenIds.has(c.id))

  return (
    <>
      <tr className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${effectiveHidden ? 'opacity-50' : ''}`}>
        <td className="py-2.5 px-4">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
            {depth > 0 && <span className="text-gray-300 select-none">└</span>}
            <span className="text-sm text-gray-800">{node.name}</span>
            {node.name_he && node.name_he !== node.name && (
              <span className="text-xs text-gray-400 hidden sm:inline">· {node.name_he}</span>
            )}
            {node.orphaned ? (
              <span className="text-[10px] text-gray-400 italic whitespace-nowrap">not on portal (parent elsewhere)</span>
            ) : inheritedHidden ? (
              <span className="text-[10px] text-gray-400 italic whitespace-nowrap">hidden by parent</span>
            ) : null}
          </div>
        </td>
        <td className="py-2.5 px-4">
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
            node.website_id ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {node.website_id ? <Tag className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
            {node.website_name}
          </span>
        </td>
        <td className="py-2.5 px-4 text-center">
          <input
            type="checkbox"
            checked={!effectiveHidden}
            disabled={cannotShow}
            onChange={() => onToggle(node.id)}
            className="h-4 w-4 rounded border-gray-300 text-brand-700 focus:ring-brand-700/20 cursor-pointer disabled:cursor-not-allowed"
          />
        </td>
        {hasChildren && (
          <td className="py-2.5 px-4 text-center">
            <button
              onClick={() => onToggleSubtree(node, !allChildrenHidden)}
              className="text-xs text-brand-700 hover:underline"
            >
              {allChildrenHidden ? 'Show all' : someChildrenHidden ? 'Hide rest' : 'Hide all'}
            </button>
          </td>
        )}
        {!hasChildren && <td />}
      </tr>
      {node.children.map(child => (
        <CategoryRow
          key={child.id}
          node={child}
          depth={depth + 1}
          hiddenIds={hiddenIds}
          inheritedHidden={effectiveHidden}
          onToggle={onToggle}
          onToggleSubtree={onToggleSubtree}
        />
      ))}
    </>
  )
}

export default function CategoriesPage() {
  const [cats, setCats] = useState<AdminCategory[]>([])
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [original, setOriginal] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/categories')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setCats(data.categories)
      const ids = new Set<number>(data.hidden_ids)
      setHiddenIds(ids)
      setOriginal(ids)
    } catch {
      setError('Could not load categories from Odoo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (id: number) => {
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSubtree = (node: CategoryNode, hide: boolean) => {
    const collectIds = (n: CategoryNode): number[] => [n.id, ...n.children.flatMap(collectIds)]
    setHiddenIds(prev => {
      const next = new Set(prev)
      for (const id of collectIds(node)) hide ? next.add(id) : next.delete(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden_ids: Array.from(hiddenIds) }),
      })
      if (!res.ok) throw new Error()
      setOriginal(new Set(hiddenIds))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save. Check Odoo connectivity.')
    } finally {
      setSaving(false)
    }
  }

  const dirty = JSON.stringify(Array.from(hiddenIds).sort()) !== JSON.stringify(Array.from(original).sort())
  const tree = buildTree(cats)
  // Count categories effectively hidden (own toggle OR any ancestor hidden), so the header
  // matches what the storefront actually shows.
  const effectiveHiddenCount = (() => {
    let count = 0
    const walk = (nodes: CategoryNode[], inherited: boolean) => {
      for (const n of nodes) {
        const eff = inherited || hiddenIds.has(n.id) || n.orphaned
        if (eff) count++
        walk(n.children, eff)
      }
    }
    walk(tree, false)
    return count
  })()
  const visibleCount = cats.length - effectiveHiddenCount

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Categories</h1>
          <p className="text-sm text-gray-400 mt-0.5">{visibleCount} of {cats.length} shown on wholesale portal</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Button onClick={save} loading={saving} disabled={!dirty}>
            <Save className="h-4 w-4 me-2" />
            {saved ? 'Saved!' : 'Save changes'}
          </Button>
          {dirty && !saving && (
            <button onClick={() => setHiddenIds(original)} className="text-sm text-gray-400 hover:text-gray-600">
              Discard
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[140px]">Category</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Scope</th>
                  <th className="text-center py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Shown</th>
                  <th className="text-center py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Children</th>
                </tr>
              </thead>
              <tbody>
                {tree.map(node => (
                  <CategoryRow
                    key={node.id}
                    node={node}
                    depth={0}
                    hiddenIds={hiddenIds}
                    inheritedHidden={false}
                    onToggle={toggle}
                    onToggleSubtree={toggleSubtree}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
