'use client'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'

interface PaginationProps {
  page: number
  total: number
  perPage: number
  onChange: (page: number) => void
}

function buildWindow(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)

  const pages: (number | '...')[] = []
  const addPage = (n: number) => { if (!pages.includes(n)) pages.push(n) }
  const addEllipsis = () => { if (pages[pages.length - 1] !== '...') pages.push('...') }

  addPage(0)
  if (current > 3) addEllipsis()
  for (let i = Math.max(1, current - 2); i <= Math.min(total - 2, current + 2); i++) addPage(i)
  if (current < total - 4) addEllipsis()
  addPage(total - 1)

  return pages
}

export function Pagination({ page, total, perPage, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / perPage)
  if (totalPages <= 1) return null

  const go = (p: number) => { onChange(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const window = buildWindow(page, totalPages)

  return (
    <div className="flex items-center justify-center gap-1 mt-8 flex-wrap">
      <button
        onClick={() => go(page - 1)}
        disabled={page === 0}
        className="flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {window.map((item, idx) =>
        item === '...' ? (
          <span key={`ellipsis-${idx}`} className="flex items-center justify-center h-10 w-10 text-gray-400">
            <MoreHorizontal className="h-4 w-4" />
          </span>
        ) : (
          <button
            key={item}
            onClick={() => go(item as number)}
            className={`flex items-center justify-center h-10 w-10 rounded-lg text-sm font-medium transition-colors ${
              item === page
                ? 'bg-brand-700 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {item + 1}
          </button>
        )
      )}

      <button
        onClick={() => go(page + 1)}
        disabled={page >= totalPages - 1}
        className="flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
