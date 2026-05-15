export default function ContentPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Content</h1>
      <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-2xl space-y-6">
        {['terms', 'privacy', 'contact'].map((slug) => (
          <div key={slug}>
            <label className="block text-sm font-semibold text-gray-700 mb-2 capitalize">{slug} (EN)</label>
            <textarea rows={4} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" defaultValue="Content placeholder..." />
            <label className="block text-sm font-semibold text-gray-700 mb-2 mt-3">{slug} (HE)</label>
            <textarea rows={4} dir="rtl" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" defaultValue="תוכן..." />
          </div>
        ))}
        <p className="text-xs text-gray-400">Content will be saved to Supabase <code className="bg-gray-50 px-1 rounded">content</code> table in Phase 5.</p>
      </div>
    </div>
  )
}
