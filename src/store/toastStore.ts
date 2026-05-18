'use client'
import { create } from 'zustand'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

interface ToastState {
  toasts: Toast[]
  show: (message: string, type?: 'success' | 'error') => void
  dismiss: (id: number) => void
}

let _nextId = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, type = 'success') => {
    const id = ++_nextId
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
