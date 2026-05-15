import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-brand-900 mb-2">B2B Ordering Portal</h1>
        <p className="text-gray-500 mb-8">Private portal for registered customers only.</p>
        <Link href="/login">
          <Button size="lg">Sign In to Order</Button>
        </Link>
      </div>
      <nav className="absolute bottom-6 flex gap-6 text-xs text-gray-400">
        <Link href="/terms" className="hover:text-gray-600">Terms</Link>
        <Link href="/privacy" className="hover:text-gray-600">Privacy</Link>
        <Link href="/contact" className="hover:text-gray-600">Contact</Link>
      </nav>
    </main>
  )
}
