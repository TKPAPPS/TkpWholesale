import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12 max-w-2xl mx-auto">
      <Link href="/" className="text-sm text-brand-600 hover:underline">← Back</Link>
      <h1 className="text-2xl font-bold mt-4 mb-6">Privacy Policy</h1>
      <div className="prose text-gray-600 space-y-4 text-sm">
        <p>Your data is processed in accordance with applicable data protection laws.</p>
        <p>We store only the data necessary to process your orders. Order data is held in Odoo.</p>
        <p>We do not sell your data to third parties.</p>
      </div>
    </main>
  )
}
