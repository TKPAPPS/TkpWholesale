'use client'
import { Order } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency, formatDate } from '@/lib/utils'
import { t, Lang } from '@/lib/i18n/translations'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { ChevronRight } from 'lucide-react'

function getSteps(lang: Lang) {
  return [
    t(lang, 'orders.stepConfirmed'),
    t(lang, 'orders.stepProcessing'),
    t(lang, 'orders.stepShipped'),
    t(lang, 'orders.stepDelivered'),
  ]
}

function statusStep(state: string, delivery: string | null): number {
  if (delivery === 'full') return 3
  if (delivery === 'partial') return 2
  if (state === 'done') return 3
  if (state === 'sale') return 1
  return 0
}

function badgeColor(step: number) {
  if (step >= 3) return 'bg-blue-50 text-blue-700 border-blue-100'
  if (step >= 2) return 'bg-purple-50 text-purple-700 border-purple-100'
  if (step >= 1) return 'bg-green-50 text-green-700 border-green-100'
  return 'bg-gray-50 text-gray-500 border-gray-200'
}

export function OrderCard({ order }: { order: Order }) {
  const { lang } = useLangStore()
  const step = statusStep(order.state, order.delivery_status)
  const steps = getSteps(lang)

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:border-brand-200 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">{order.name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${badgeColor(step)}`}>
              {order.state_label}
            </span>
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

      {/* Progress bar */}
      <div className="flex items-center gap-1">
        {steps.map((label, i) => (
          <div key={label} className="flex-1 flex flex-col gap-1">
            <div className={`h-1 rounded-full transition-colors ${i <= step ? 'bg-brand-700' : 'bg-gray-100'}`} />
            <span className={`text-[10px] font-medium ${i <= step ? 'text-brand-700' : 'text-gray-300'}`}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
