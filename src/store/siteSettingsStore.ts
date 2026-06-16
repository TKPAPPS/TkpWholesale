'use client'
import { create } from 'zustand'
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/site-settings'

interface SiteSettingsState {
  settings: SiteSettings
  hydrate: () => Promise<void>
}

// Holds the admin-tuned storefront rules. Starts at the defaults (which equal the
// previously-hardcoded values), then hydrates once from /api/site-settings so there
// is never a flash of wrong behaviour.
export const useSiteSettingsStore = create<SiteSettingsState>((set) => ({
  settings: DEFAULT_SITE_SETTINGS,
  hydrate: async () => {
    try {
      const res = await fetch('/api/site-settings')
      if (!res.ok) return
      const data = await res.json()
      set({ settings: { ...DEFAULT_SITE_SETTINGS, ...data } })
    } catch {
      // keep defaults
    }
  },
}))
