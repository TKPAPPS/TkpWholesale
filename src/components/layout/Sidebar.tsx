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
      <button
        className={cn(
          'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors text-start',
          isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700 hover:bg-gray-50',
          depth > 0 && 'ps-6 text-xs',
        )}
        onClick={() => {
          onSelect(cat.id)
          if (hasChildren) setOpen(!open)
        }}
      >
        <span className="flex-1">{name}</span>
        {hasChildren && (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />)}
      </button>
      {hasChildren && open && (
        <div className="ms-2">
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
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-3 mb-2">Categories</p>
      <button
        className={cn(
          'w-full text-start rounded-lg px-3 py-2 text-sm transition-colors',
          selectedCategoryId === null ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700 hover:bg-gray-50',
        )}
        onClick={() => onSelect(null)}
      >
        {t(lang, 'products.allCategories')}
      </button>
      {categories.map((cat) => (
        <CategoryItem key={cat.id} cat={cat} selectedId={selectedCategoryId} onSelect={onSelect} />
      ))}
    </aside>
  )
}
