export default function AdminDashboard() {
  const stats = [
    { label: 'Active Sessions', value: '12' },
    { label: 'Orders Today', value: '7' },
    { label: 'Odoo Status', value: 'Online' },
    { label: 'Open Cart Warnings', value: '0' },
  ]
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-gray-400">Full admin features will be connected to Supabase in Phase 5.</p>
    </div>
  )
}
