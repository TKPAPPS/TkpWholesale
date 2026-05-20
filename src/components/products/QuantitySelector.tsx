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
          const v = parseInt(e.target.value)
          if (!isNaN(v) && v >= min && v <= max) onChange(v)
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
