'use client'
import { useToastStore } from '@/store/toastStore'
import { CheckCircle, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Toast() {
  const { toasts, dismiss } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 end-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto',
            'animate-in slide-in-from-bottom-4 fade-in duration-200',
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white',
          )}
        >
          {toast.type === 'success'
            ? <CheckCircle className="h-4 w-4 shrink-0" />
            : <XCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button onClick={() => dismiss(toast.id)} className="ms-1 opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
