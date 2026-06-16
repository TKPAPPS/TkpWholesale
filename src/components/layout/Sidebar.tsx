'use client'
import { Category } from '@/types'
import { useLangStore } from '@/store/langStore'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface SidebarProps {
  categories: Category[]
  selectedCategoryId: number | null
  onSelect: (id: number | null) => void
}

// Shared row styling: a left accent bar (logical start, RTL-aware) marks the active row.
const rowBase = 'group flex items-center rounded-lg border-s-2 transition-colors'
const rowActive = 'bg-brand-50 text-brand-700 font-medium border-brand-700'
const rowIdle = 'text-gray-700 border-transparent hover:bg-gray-50'

function CategoryItem({ cat, selectedId, onSelect, depth = 0 }: {
  cat: Category
  selectedId: number | null
  onSelect: (id: number | null) => void
  depth?: number
}) {
  const { lang } = useLangStore()
  const [open, setOpen] = useState(selectedId === cat.id || cat.children.some((c) => c.id === selectedId))
  const name = lang === 'he' ? cat.name_he : cat.name
  const hasChildren = cat.children.length > 0
  const isSelected = selectedId === cat.id

  return (
    <div>
      {/* Label selects; the chevron only expands (distinct targets). */}
      <div className={cn(rowBase, isSelected ? rowActive : rowIdle)}>
        <button
          className={cn('flex-1 px-3 py-2.5 text-sm text-start truncate', depth > 0 && 'ps-5 text-[13px]')}
          onClick={() => onSelect(cat.id)}
        >
          {name}
        </button>
        {hasChildren && (
          <button
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="px-2 py-2.5 text-gray-300 group-hover:text-gray-400 transition-colors shrink-0"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
          </button>
        )}
      </div>
      {hasChildren && open && (
        <div className="ms-3 mt-0.5 space-y-0.5">
          {cat.children.map((child) => (
            <CategoryItem key={child.id} cat={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ categories, selectedCategoryId, onSelect }: SidebarProps) {
  const { lang } = useLangStore()
  return (
    <aside className="w-56 shrink-0 sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 px-2 mb-2">
        {t(lang, 'nav.categories')}
      </p>
      <div className="bg-white rounded-2xl border border-gray-100 p-2 space-y-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <button
          className={cn(rowBase, 'w-full px-3 py-2.5 text-sm text-start', selectedCategoryId === null ? rowActive : rowIdle)}
          onClick={() => onSelect(null)}
        >
          {t(lang, 'products.allCategories')}
        </button>
        {categories.map((cat) => (
          <CategoryItem key={cat.id} cat={cat} selectedId={selectedCategoryId} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  )
}
