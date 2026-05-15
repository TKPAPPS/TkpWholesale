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
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4 hover:border-brand-200 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-gray-900">{order.name}</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">{order.state_label}</span>
        </div>
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
  )
}
