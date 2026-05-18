import { ShieldCheck } from 'lucide-react'

export default function AuditPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Audit Log</h1>
      <div className="bg-white rounded-xl border border-gray-100 p-10 flex flex-col items-center text-center">
        <ShieldCheck className="h-8 w-8 text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-700 mb-1">No audit database configured</p>
        <p className="text-xs text-gray-400 max-w-sm">
          Admin audit events (settings changes, category updates, logins) are recorded in Supabase.
          Connect a Supabase project and set the env vars to enable the audit trail.
        </p>
      </div>
    </div>
  )
}
