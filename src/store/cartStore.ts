'use client'
import { create } from 'zustand'
import type { Cart } from '@/types'

interface CartState {
  cart: Cart | null
  isLoading: boolean
  odooUnavailable: boolean
  setCart: (cart: Cart | null) => void
  setLoading: (v: boolean) => void
  setUnavailable: (v: boolean) => void
  lineCount: () => number       // unique products (number of lines)
  fetchCart: () => Promise<void>
}

export const useCartStore = create<CartState>((set, get) => ({
  cart: null,
  isLoading: false,
  odooUnavailable: false,
  setCart: (cart) => set({ cart }),
  setLoading: (isLoading) => set({ isLoading }),
  setUnavailable: (odooUnavailable) => set({ odooUnavailable }),
  lineCount: () => get().cart?.lines.length ?? 0,
  fetchCart: async () => {
    try {
      const res = await fetch('/api/cart')
      if (!res.ok) return
      const data = await res.json()
      set({ cart: data })
    } catch {
      // silently ignore — badge stays at 0
    }
  },
}))
