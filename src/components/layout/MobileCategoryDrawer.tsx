'use client'
import { useEffect } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { Category } from '@/types'
import { Sidebar } from './Sidebar'
import { cn } from '@/lib/utils'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'

interface MobileCategoryDrawerProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  selectedCategoryId: number | null
  onSelect: (id: number | null) => void
}

export function MobileCategoryDrawer({ open, onClose, categories, selectedCategoryId, onSelect }: MobileCategoryDrawerProps) {
  const { lang } = useLangStore()
  const isRtl = lang === 'he'

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleSelect = (id: number | null) => {
    onSelect(id)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn('fixed inset-0 bg-black/40 z-40 lg:hidden transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        onClick={onClose}
      />

      {/* Drawer panel — in RTL (Hebrew) `start-0` = right:0, so closed state slides right */}
      <div
        className={cn(
          'fixed top-0 start-0 h-full w-72 bg-white z-50 lg:hidden shadow-xl transition-transform duration-300 ease-in-out overflow-y-auto',
          open ? 'translate-x-0' : isRtl ? 'translate-x-full' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900">{t(lang, 'nav.categories')}</span>
          <button onClick={onClose} className="flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">
          <Sidebar categories={categories} selectedCategoryId={selectedCategoryId} onSelect={handleSelect} />
        </div>
      </div>
    </>
  )
}

export function MobileCategoryButton({ onClick, selectedCategoryId, selectedLabel }: { onClick: () => void; selectedCategoryId: number | null; selectedLabel?: string }) {
  const { lang } = useLangStore()
  return (
    <button
      onClick={onClick}
      className={cn(
        'lg:hidden flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors shrink-0 max-w-[55%]',
        selectedCategoryId !== null
          ? 'border-brand-700 bg-brand-50 text-brand-700'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
      )}
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0" />
      <span className="truncate">{selectedCategoryId !== null ? (selectedLabel || t(lang, 'nav.categories')) : t(lang, 'nav.categories')}</span>
    </button>
  )
}
