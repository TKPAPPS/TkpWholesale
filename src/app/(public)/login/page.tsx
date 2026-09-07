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
import Link from 'next/link'

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
      {/* Left panel - decorative wine + gold */}
      <div className="relative hidden lg:flex flex-col justify-between w-[46%] p-12 overflow-hidden bg-[linear-gradient(155deg,#541029_0%,#6B1535_48%,#3d0c1d_100%)]">
        {/* Soft gold glow + subtle texture */}
        <div className="pointer-events-none absolute -top-24 -end-24 h-96 w-96 rounded-full bg-gold/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:22px_22px]" />
        {/* Gold hairline framing the panel */}
        <div className="pointer-events-none absolute inset-6 rounded-2xl border border-gold/15" />

        <div className="relative">
          <Logo className="h-20 w-auto brightness-0 invert opacity-95" />
        </div>

        <div className="relative space-y-4">
          <p className="text-gold text-xs uppercase tracking-[0.25em] font-semibold">{t(lang, 'auth.brandEyebrow')}</p>
          <h2 className="text-white text-[2.6rem] font-serif font-bold leading-[1.1]">
            The Kosher Place
          </h2>
          <div className="h-px w-16 bg-gold/70" />
          <p className="text-white/55 text-sm max-w-xs leading-relaxed">
            {t(lang, 'auth.brandTagline')}
          </p>
        </div>

        <p className="relative text-white/40 text-xs">
          © {new Date().getFullYear()} The Kosher Place (Thailand) Co. Ltd.
        </p>
      </div>

      {/* Right panel - form */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-12 bg-[#fdfbfa]">
        <div className="w-full max-w-sm space-y-8">

          {/* Logo (mobile) */}
          <div className="lg:hidden flex flex-col items-center gap-3">
            <Logo className="h-16 w-auto" />
            <div className="h-px w-12 bg-gold/70" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t(lang, 'auth.welcome')}</h1>
            <div className="mt-2 h-0.5 w-10 rounded-full bg-gold" />
            <p className="text-sm text-gray-500 mt-3">{t(lang, 'auth.privatePortal')}</p>
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
                // h-9 w-9 flex box, not a bare 18px icon: WCAG 2.5.8 wants a 24px
                // minimum target. The offsets keep the icon optically where it was.
                className="absolute end-[3px] top-[29px] flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:text-gray-700"
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

          {/* gray-600, not gray-400: #9ca3af on this near-white panel is 2.46:1, under the 4.5:1 minimum. */}
          <p className="text-center text-xs text-gray-600 leading-relaxed">
            {t(lang, 'auth.accessNote')}
            <br />
            <Link href="/contact" className="text-brand-700 hover:underline">
              {t(lang, 'auth.contactRep')}
            </Link>{' '}
            {t(lang, 'auth.toRequestAccess')}
          </p>
        </div>
      </div>
    </main>
  )
}
