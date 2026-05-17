import Link from 'next/link'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-6 relative overflow-hidden">

      {/* Subtle background rings */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-brand-100 opacity-60" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-brand-50 opacity-40" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-xl w-full">

        {/* Logo */}
        <Logo className="w-80 sm:w-96 h-auto mb-8" />

        {/* Gold rule */}
        <div className="flex items-center gap-4 w-full max-w-xs mb-8">
          <div className="flex-1 h-px bg-gold opacity-50" />
          <div className="h-1.5 w-1.5 rounded-full bg-gold opacity-60" />
          <div className="flex-1 h-px bg-gold opacity-50" />
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold text-brand-700 tracking-wide leading-snug mb-3">
          The Kosher Place<br />Wholesale Website
        </h1>

        {/* Subtitle */}
        <p className="text-sm text-gray-400 tracking-wide mb-10">
          Private portal for registered customers only.
        </p>

        {/* CTA */}
        <Link href="/login">
          <Button size="lg" className="px-10 text-base shadow-md shadow-brand-200">
            Sign In to Order
          </Button>
        </Link>

      </div>

      {/* Footer links */}
      <nav className="absolute bottom-6 flex gap-8 text-xs text-gray-300">
        <Link href="/terms" className="hover:text-gray-500 transition-colors">Terms</Link>
        <Link href="/privacy" className="hover:text-gray-500 transition-colors">Privacy</Link>
        <Link href="/contact" className="hover:text-gray-500 transition-colors">Contact</Link>
      </nav>
    </main>
  )
}
