export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Portal name</label>
          <input defaultValue="B2B Portal" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Support email</label>
          <input defaultValue="support@company.com" type="email" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Abandoned cart TTL (days)</label>
          <input defaultValue="7" type="number" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <p className="text-xs text-gray-400">Settings will be saved to Supabase in Phase 5.</p>
      </div>
    </div>
  )
}
