'use client'
import { Order } from '@/types'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLangStore } from '@/store/langStore'
import { useCartStore } from '@/store/cartStore'
import { useToastStore } from '@/store/toastStore'
import { formatCurrency, formatDate } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { ChevronRight, RefreshCw } from 'lucide-react'

// Same state ladder as the dashboard rows (draft/sent = pending, sale = confirmed, done = delivered).
const STATE_STEP: Record<string, number> = { draft: 0, sent: 1, sale: 2, done: 3 }

export function OrderCard({ order }: { order: Order }) {
  const { lang } = useLangStore()
  const router = useRouter()
  const reorderLines = useCartStore((s) => s.reorderLines)
  const showToast = useToastStore((s) => s.show)
  const [reordering, setReordering] = useState(false)

  const step = STATE_STEP[order.state] ?? 0

  const reorder = async () => {
    setReordering(true)
    try {
      const detail = await fetch(`/api/orders/${order.id}`).then(r => r.json())
      const lines = (detail.lines ?? []).map((line: { template_id: number; packaging_id: number; packaging_qty: number }) => ({
        product_id: line.template_id, packaging_id: line.packaging_id, packaging_qty: line.packaging_qty,
      }))
      const { failed } = await reorderLines(lines)
      if (failed > 0) showToast(`${failed} item${failed > 1 ? 's' : ''} could not be added to cart`, 'error')
      router.push('/cart')
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:border-brand-200 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">{order.name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${step >= 3 ? 'bg-blue-50 text-blue-700 border-blue-100' : step >= 2 ? 'bg-green-50 text-green-700 border-green-100' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
              {order.state_label}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(order.date_order, lang)} · {order.line_count} {t(lang, order.line_count === 1 ? 'orders.line' : 'orders.lines')}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(order.amount_total, order.currency)}</p>
          <Button variant="ghost" size="sm" loading={reordering} onClick={reorder}>
            <RefreshCw className="h-3.5 w-3.5 me-1" /> {t(lang, 'orders.reorder')}
          </Button>
          <Link href={`/orders/${order.id}`}>
            <Button variant="secondary" size="sm">
              {t(lang, 'orders.viewDetail')} <ChevronRight className="h-3.5 w-3.5 ms-1" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
