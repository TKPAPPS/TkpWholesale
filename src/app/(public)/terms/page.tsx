import Link from 'next/link'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12 max-w-2xl mx-auto">
      <Link href="/" className="text-sm text-brand-700 hover:underline">← Back</Link>
      <h1 className="text-2xl font-bold mt-4 mb-6">Terms of Use</h1>
      <div className="prose text-gray-600 space-y-4 text-sm">
        <p>This portal is for registered B2B customers only. Access is restricted.</p>
        <p>All orders placed through this portal are subject to our standard trading terms and conditions.</p>
        <p>For questions, contact your sales representative.</p>
      </div>
    </main>
  )
}
