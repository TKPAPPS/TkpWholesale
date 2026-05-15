import Link from 'next/link'

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12 max-w-2xl mx-auto">
      <Link href="/" className="text-sm text-brand-700 hover:underline">← Back</Link>
      <h1 className="text-2xl font-bold mt-4 mb-6">Contact</h1>
      <div className="text-gray-600 space-y-2 text-sm">
        <p>For portal access or order support, contact your sales representative directly.</p>
        <p className="mt-4 font-medium">Support hours: Sun–Thu, 8:00–17:00</p>
      </div>
    </main>
  )
}
