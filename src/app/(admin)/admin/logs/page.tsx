import { ScrollText } from 'lucide-react'

export default function LogsPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Portal Logs</h1>
      <div className="bg-white rounded-xl border border-gray-100 p-10 flex flex-col items-center text-center">
        <ScrollText className="h-8 w-8 text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-700 mb-1">No logging database configured</p>
        <p className="text-xs text-gray-400 max-w-sm">
          Portal activity logs (logins, cart events, order confirmations) are written to Supabase.
          Connect a Supabase project and set the env vars to enable logging.
        </p>
      </div>
    </div>
  )
}
