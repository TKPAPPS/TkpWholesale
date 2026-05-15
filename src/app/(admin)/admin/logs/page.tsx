export default function LogsPage() {
  const logs = [
    { ts: '2026-05-15 09:12', partner: 'Acme Foods', event: 'login', meta: '' },
    { ts: '2026-05-15 09:15', partner: 'Acme Foods', event: 'cart.line.add', meta: 'OIL-EV-5L × 2' },
    { ts: '2026-05-15 09:22', partner: 'Acme Foods', event: 'order.confirm', meta: 'S00123' },
    { ts: '2026-05-14 16:40', partner: 'Beta Imports', event: 'login', meta: '' },
    { ts: '2026-05-14 16:55', partner: 'Beta Imports', event: 'cart.clear', meta: '' },
  ]
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Portal Logs</h1>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Time', 'Customer', 'Event', 'Detail'].map((h) => <th key={h} className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{l.ts}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{l.partner}</td>
                <td className="px-4 py-3 text-gray-600"><code className="text-xs bg-gray-50 px-1.5 py-0.5 rounded">{l.event}</code></td>
                <td className="px-4 py-3 text-gray-400">{l.meta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
