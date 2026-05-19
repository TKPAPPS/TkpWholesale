'use client'
import { Order } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency, formatDate } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { ChevronRight } from 'lucide-react'

export function OrderCard({ order }: { order: Order }) {
  const { lang } = useLangStore()

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:border-brand-200 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 truncate">{order.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.date_order, lang)} · {order.line_count} {t(lang, 'orders.lines')}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(order.amount_total, order.currency)}</p>
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
