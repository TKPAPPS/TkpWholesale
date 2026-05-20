'use client'
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

interface HealthCheck {
  name: string
  endpoint: string
  status: string
  latency: string
}

export default function HealthPage() {
  const [checks, setChecks] = useState<HealthCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/health')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setChecks(data.checks)
      setLastChecked(new Date())
    } catch {
      setError('Could not run health checks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function statusBadge(status: string) {
    if (status === 'ok') return 'bg-green-50 text-green-700'
    if (status === 'error') return 'bg-red-50 text-red-700'
    if (status === 'configured') return 'bg-blue-50 text-blue-700'
    return 'bg-gray-100 text-gray-500'
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">API Health</h1>
          {lastChecked && (
            <p className="text-xs text-gray-400 mt-0.5">Last checked: {lastChecked.toLocaleTimeString()}</p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading && checks.length === 0 ? (
        <p className="text-sm text-gray-400">Running checks…</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Service', 'Endpoint', 'Status', 'Latency'].map((h) => (
                    <th key={h} className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.name} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{c.endpoint}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{c.latency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
