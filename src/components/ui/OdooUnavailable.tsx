'use client'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

interface OdooUnavailableProps {
  message?: string
  onRetry?: () => void
}

export function OdooUnavailable({ message, onRetry }: OdooUnavailableProps) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 flex flex-col items-center text-center gap-3">
      <AlertTriangle className="h-8 w-8 text-amber-500" />
      <p className="text-sm font-medium text-amber-800">
        {message ?? 'The ordering system is temporarily unavailable. Please try again in a few minutes.'}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
