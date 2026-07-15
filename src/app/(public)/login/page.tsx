'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useLangStore, initLang } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { Logo } from '@/components/layout/Logo'
import { useAuthStore } from '@/store/authStore'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { lang } = useLangStore()
  const { setUser } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
        // Surface the rate-limit message specifically; everything else is generic.
        setError(res.status === 429 && data.message ? data.message : t(lang, 'auth.loginError'))
        return
      }
      setUser(data.user)
      // Land on the dashboard: order history + one-click Reorder is the core
      // repeat-buyer flow, and /products is one click away.
      const redirect = searchParams.get('redirect') ?? '/dashboard'
      router.push(redirect)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-white flex">
      {/* Left panel — decorative */}
      <div className="hidden lg:flex flex-col justify-between w-[44%] bg-brand-700 p-12">
        <Logo className="h-20 w-auto brightness-0 invert opacity-90" />

        <div className="space-y-4">
          <p className="text-white/60 text-sm uppercase tracking-widest font-medium">Wholesale Portal</p>
          <h2 className="text-white text-4xl font-serif font-bold leading-tight">
            The Kosher Place<br />Wholesale Website.
          </h2>
          <p className="text-white/50 text-sm">Private portal for registered customers only.</p>
        </div>

        <p className="text-white/40 text-xs">
          © {new Date().getFullYear()} The Kosher Place (Thailand) Co. Ltd.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-12">
        <div className="w-full max-w-sm space-y-8">

          {/* Logo (mobile) */}
          <div className="lg:hidden flex justify-center">
            <Logo className="h-16 w-auto" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t(lang, 'auth.welcome')}</h1>
            <p className="text-sm text-gray-500 mt-1">{t(lang, 'auth.privatePortal')}</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <Input
              id="email"
              type="email"
              label={t(lang, 'auth.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                label={t(lang, 'auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t(lang, 'auth.hidePassword') : t(lang, 'auth.showPassword')}
                className="absolute end-3 top-[38px] text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
                <p className="text-sm text-red-700 text-center">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {t(lang, 'auth.loginButton')}
            </Button>
          </form>

          <div className="flex justify-center">
            <LanguageSwitcher />
          </div>

          <p className="text-center text-xs text-gray-400 leading-relaxed">
            Access restricted to registered wholesale customers.
            <br />Contact your sales representative to request access.
          </p>
        </div>
      </div>
    </main>
  )
}
