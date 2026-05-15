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
  lineCount: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
  cart: null,
  isLoading: false,
  odooUnavailable: false,
  setCart: (cart) => set({ cart }),
  setLoading: (isLoading) => set({ isLoading }),
  setUnavailable: (odooUnavailable) => set({ odooUnavailable }),
  lineCount: () => get().cart?.lines.reduce((sum, l) => sum + l.packaging_qty, 0) ?? 0,
}))
