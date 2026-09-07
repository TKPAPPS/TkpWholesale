'use client'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLangStore } from '@/store/langStore'
import { useQuantityInput } from '@/hooks/useQuantityInput'
import { t } from '@/lib/i18n/translations'

interface QuantitySelectorProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  className?: string
  size?: 'sm' | 'md'
}

export function QuantitySelector({ value, onChange, min = 1, max = 999, className, size = 'md' }: QuantitySelectorProps) {
  const sm = size === 'sm'
  const { lang } = useLangStore()
  const qty = useQuantityInput(value, min, onChange)
  return (
    <div className={cn('flex items-center border border-gray-200 rounded-lg overflow-hidden', className)}>
      <button
        type="button"
        aria-label={t(lang, 'products.decreaseQty')}
        onClick={() => { qty.clearDraft(); onChange(Math.max(min, value - 1)) }}
        disabled={value <= min}
        className={cn(
          'flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          // shrink-0 is load-bearing: these sit in a flex row inside a ~117px product card,
          // and without it they were squeezed to ~17px wide tap targets on a 360px phone.
          'shrink-0',
          sm ? 'h-8 w-8' : 'h-9 w-9',
        )}
      >
        <Minus className={sm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
      <input
        type="number"
        // A bare number input with no name and no label: screen readers announced
        // nothing and Chrome flagged 26 unnamed fields on one products page.
        name="quantity"
        aria-label={t(lang, 'products.quantity')}
        // inputMode gets phones to open the plain number pad rather than the
        // full keyboard's numeric pane.
        inputMode="numeric"
        // value/onChange/onBlur come from useQuantityInput so the field can be
        // CLEARED and retyped. Binding straight to `value` made backspace snap
        // the old digit back, on desktop as well as mobile.
        value={qty.value}
        min={min}
        max={max}
        onChange={qty.onChange}
        onBlur={qty.onBlur}
        className={cn('text-center text-sm font-medium border-0 focus:outline-none bg-transparent', sm ? 'w-full min-w-0 flex-1' : 'w-12')}
      />
      <button
        type="button"
        aria-label={t(lang, 'products.increaseQty')}
        onClick={() => { qty.clearDraft(); onChange(Math.min(max, value + 1)) }}
        disabled={value >= max}
        className={cn(
          'flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          // shrink-0 is load-bearing: these sit in a flex row inside a ~117px product card,
          // and without it they were squeezed to ~17px wide tap targets on a 360px phone.
          'shrink-0',
          sm ? 'h-8 w-8' : 'h-9 w-9',
        )}
      >
        <Plus className={sm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
    </div>
  )
}
