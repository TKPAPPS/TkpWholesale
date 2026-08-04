'use client'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  return (
    <div className={cn('flex items-center border border-gray-200 rounded-lg overflow-hidden', className)}>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className={cn(
          'flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          sm ? 'h-7 w-7' : 'h-9 w-9',
        )}
      >
        <Minus className={sm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          // Free typing, no upper-bound clamp: earlier this rejected (then clamped) any
          // keystroke that pushed the value past `max`, which fought the user mid-type no
          // matter how it was handled (silently ignored, or snapping back to the cap after
          // every extra digit) — it read as a broken input either way. `max` still guides the
          // +/- buttons below; the real enforcement is server-side on Add (with a toast if the
          // requested quantity has to be reduced), which is where it belongs.
          const v = parseInt(e.target.value)
          if (isNaN(v) || v < min) return
          onChange(v)
        }}
        className={cn('text-center text-sm font-medium border-0 focus:outline-none bg-transparent', sm ? 'w-6' : 'w-12')}
      />
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className={cn(
          'flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          sm ? 'h-7 w-7' : 'h-9 w-9',
        )}
      >
        <Plus className={sm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
    </div>
  )
}
