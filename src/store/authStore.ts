'use client'
import { create } from 'zustand'
import type { User } from '@/types'

const SESSION_KEY = 'b2b_user'

interface AuthState {
  user: User | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setLoading: (v: boolean) => void
  hydrate: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => {
    try {
      if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user))
      else sessionStorage.removeItem(SESSION_KEY)
    } catch { /* sessionStorage unavailable (private browsing, SSR) */ }
    set({ user })
  },
  setLoading: (isLoading) => set({ isLoading }),
  // Synchronously populate user from sessionStorage so the layout renders
  // without a spinner for returning users who already have a valid session.
  // The layout still validates the cookie server-side in the background.
  hydrate: () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) set({ user: JSON.parse(raw) as User, isLoading: false })
    } catch { /* ignore - sessionStorage unavailable or JSON malformed */ }
  },
}))
