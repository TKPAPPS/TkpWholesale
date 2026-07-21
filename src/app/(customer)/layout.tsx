'use client'
import { useEffect, useLayoutEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { useLangStore, initLang } from '@/store/langStore'
import { hasLangCookie } from '@/lib/utils'
import { useCartStore } from '@/store/cartStore'
import { useSiteSettingsStore } from '@/store/siteSettingsStore'
import { useCategoriesStore } from '@/store/categoriesStore'
import { Navbar } from '@/components/layout/Navbar'
import { BottomNav } from '@/components/layout/BottomNav'
import { AnnouncementBanner } from '@/components/layout/AnnouncementBanner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, isLoading, setUser, setLoading, hydrate } = useAuthStore()
  const { setLang } = useLangStore()
  const fetchCart = useCartStore((s) => s.fetchCart)
  const hydrateSiteSettings = useSiteSettingsStore((s) => s.hydrate)
  const hydrateCategories = useCategoriesStore((s) => s.hydrate)

  // useLayoutEffect runs synchronously before the browser paints, so returning
  // users who have a cached session never see the spinner flash.
  useLayoutEffect(() => { hydrate() }, [])

  useEffect(() => {
    // Capture BEFORE initLang() writes the cookie: a first-ever visit has no
    // lang cookie and should adopt the Odoo profile lang; after that the
    // user's (or a prior visit's) choice must not be stomped on every load.
    const hadLangChoice = hasLangCookie()
    initLang()
    // Fire cart fetch immediately — it uses the session cookie directly
    // and doesn't need the auth result. Runs in parallel with auth check.
    fetchCart()
    hydrateSiteSettings()
    hydrateCategories()
    fetch('/api/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('not authenticated')
        return res.json()
      })
      .then((user) => {
        setUser(user)
        if (!hadLangChoice) setLang(user.lang === 'he' ? 'he' : 'en')
      })
      .catch(() => {
        router.push('/login?redirect=' + encodeURIComponent(window.location.pathname))
      })
      .finally(() => setLoading(false))
  }, [])

  // Re-validate the session periodically and whenever the tab becomes visible, so a
  // customer deactivated in Odoo (or whose session expired) is bounced within minutes
  // rather than continuing to use a stale tab. /api/auth/me does the active re-check.
  useEffect(() => {
    const revalidate = () => {
      fetch('/api/auth/me').then((res) => {
        if (!res.ok) {
          setUser(null)
          router.push('/login?redirect=' + encodeURIComponent(window.location.pathname))
        }
      }).catch(() => {})
    }
    const interval = setInterval(revalidate, 5 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [router, setUser])

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
      {/* pb leaves room for the fixed mobile bottom nav; reset on md+ */}
      <main className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8 pt-8 pb-24 md:pb-8">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
