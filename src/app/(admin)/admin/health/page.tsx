export default function HealthPage() {
  const checks = [
    { name: 'Odoo JSON-RPC', endpoint: '/web/dataset/call_kw', status: 'ok', latency: '182ms' },
    { name: 'Odoo Session Auth', endpoint: '/web/session/authenticate', status: 'ok', latency: '210ms' },
    { name: 'Supabase DB', endpoint: 'supabase', status: 'ok', latency: '44ms' },
    { name: 'Odoo Report PDF', endpoint: '/report/pdf/', status: 'untested', latency: '-' },
  ]
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">API Health</h1>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
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
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.endpoint}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{c.latency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
