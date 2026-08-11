'use client'
import { create } from 'zustand'
import { Category } from '@/types'

interface CategoriesState {
  categories: Category[]
  loaded: boolean
  hydrate: () => Promise<void>
}

// Global category tree, fetched once and shared across the navbar dropdown, the
// product sidebar, and the mobile drawer - so categories are reachable from any page,
// not just /products.
export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  loaded: false,
  hydrate: async () => {
    if (get().loaded) return
    try {
      const res = await fetch('/api/categories')
      if (!res.ok) return
      const data = await res.json()
      set({ categories: data.categories ?? [], loaded: true })
    } catch {
      // keep empty; nav simply won't show categories
    }
  },
}))
