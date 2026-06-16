'use client'
import { useEffect, useLayoutEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { useLangStore, initLang } from '@/store/langStore'
import { useCartStore } from '@/store/cartStore'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'
import { Navbar } from '@/components/layout/Navbar'
import { AnnouncementBanner } from '@/components/layout/AnnouncementBanner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, isLoading, setUser, setLoading, hydrate } = useAuthStore()
  const { setLang } = useLangStore()
  const fetchCart = useCartStore((s) => s.fetchCart)
  const hydrateSiteSettings = useSiteSettingsStore((s) => s.hydrate)

  // useLayoutEffect runs synchronously before the browser paints, so returning
  // users who have a cached session never see the spinner flash.
  useLayoutEffect(() => { hydrate() }, [])

  useEffect(() => {
    initLang()
    // Fire cart fetch immediately — it uses the session cookie directly
    // and doesn't need the auth result. Runs in parallel with auth check.
    fetchCart()
    hydrateSiteSettings()
    fetch('/api/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('not authenticated')
        return res.json()
      })
      .then((user) => {
        setUser(user)
        setLang(user.lang === 'he_IL' ? 'he' : 'en')
      })
      .catch(() => {
        router.push('/login?redirect=' + encodeURIComponent(window.location.pathname))
      })
      .finally(() => setLoading(false))
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
        <LoadingSpinner />
        <p className="text-sm text-gray-400">Loading your portal…</p>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <Navbar />
      <AnnouncementBanner />
      <main className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
