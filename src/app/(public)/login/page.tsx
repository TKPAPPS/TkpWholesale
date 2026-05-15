'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useLangStore, initLang } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { useAuthStore } from '@/store/authStore'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { lang } = useLangStore()
  const { setUser } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { initLang() }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(t(lang, 'auth.loginError'))
        return
      }
      setUser(data.user)
      const redirect = searchParams.get('redirect') ?? '/products'
      router.push(redirect)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-brand-900">{t(lang, 'auth.welcome')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t(lang, 'auth.privatePortal')}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              id="email"
              type="email"
              label={t(lang, 'auth.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Input
              id="password"
              type="password"
              label={t(lang, 'auth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {t(lang, 'auth.loginButton')}
            </Button>
          </form>
        </div>

        <div className="mt-4 flex justify-center">
          <LanguageSwitcher />
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Access is restricted to registered customers.
          <br />Contact your sales representative to request access.
        </p>
      </div>
    </main>
  )
}
