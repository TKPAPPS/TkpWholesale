'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { useLangStore, initLang } from '@/store/langStore'
import { Navbar } from '@/components/layout/Navbar'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, isLoading, setUser, setLoading } = useAuthStore()
  const { setLang } = useLangStore()

  useEffect(() => {
    initLang()
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  )
}
