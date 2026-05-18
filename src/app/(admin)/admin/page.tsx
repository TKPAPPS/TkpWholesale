'use client'
import { useEffect, useState } from 'react'

interface DashboardData {
  orders_today: number
  open_carts: number
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setError(true))
  }, [])

  const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL

  const stats = [
    { label: 'Orders Today', value: data ? String(data.orders_today) : '—' },
    { label: 'Open Carts', value: data ? String(data.open_carts) : '—' },
    { label: 'Active Sessions', value: supabaseConfigured ? '—' : 'N/A' },
    { label: 'Odoo Status', value: error ? 'Error' : data ? 'Online' : '…' },
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
      {error && (
        <p className="text-sm text-red-500 mb-4">Could not reach Odoo — check connectivity.</p>
      )}
      {!supabaseConfigured && (
        <p className="text-sm text-gray-400">
          Active sessions and portal logs require a Supabase database. Settings and categories are managed via Odoo.
        </p>
      )}
    </div>
  )
}
