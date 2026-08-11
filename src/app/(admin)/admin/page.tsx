'use client'
import { useEffect, useState } from 'react'
import { Megaphone, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import { useToastStore } from '@/store/toastStore'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface DashboardData {
  orders_today: number
  open_carts: number
}

interface Announcement {
  id: number
  message: string
  type: 'info' | 'warning' | 'success'
  active: boolean
  starts_at: string | null
  expires_at: string | null
  created_at: string
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [newMsg, setNewMsg] = useState('')
  const [newType, setNewType] = useState<'info' | 'warning' | 'success'>('info')
  const [newStart, setNewStart] = useState('')
  const [newExpiry, setNewExpiry] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const showToast = useToastStore((s) => s.show)

  const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) return
    fetch('/api/admin/announcements')
      .then((r) => r.json())
      .then((d) => setAnnouncements(d.announcements ?? []))
      .catch(() => {})
  }, [supabaseConfigured])

  const createAnnouncement = async () => {
    if (!newMsg.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMsg.trim(), type: newType, starts_at: newStart || null, expires_at: newExpiry || null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = await res.json()
      setAnnouncements((prev) => [created, ...prev])
      setNewMsg('')
      setNewStart('')
      setNewExpiry('')
      showToast('Announcement posted')
    } catch {
      showToast('Could not post announcement. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (id: number, active: boolean) => {
    // Optimistic flip, rolled back if the server rejects it.
    setAnnouncements((prev) => prev.map((a) => a.id === id ? { ...a, active: !active } : a))
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !active }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      setAnnouncements((prev) => prev.map((a) => a.id === id ? { ...a, active } : a))
      showToast('Could not update announcement.', 'error')
    }
  }

  const confirmDelete = async () => {
    if (pendingDelete == null) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/announcements?id=${pendingDelete}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAnnouncements((prev) => prev.filter((a) => a.id !== pendingDelete))
      showToast('Announcement deleted')
      setPendingDelete(null)
    } catch {
      showToast('Could not delete announcement. Please try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const stats = [
    // ?? guards: a partial API response must show the placeholder, not "undefined".
    { label: 'Orders Today', value: String(data?.orders_today ?? '-') },
    { label: 'Open Carts', value: String(data?.open_carts ?? '-') },
    { label: 'Odoo Status', value: error ? 'Error' : data ? 'Online' : '…' },
  ]

  const TYPE_COLORS = {
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    success: 'bg-green-50 text-green-700 border-green-200',
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h1>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-red-500 mt-4">Could not reach Odoo - check connectivity.</p>}
      </div>

      {/* Announcements */}
      {supabaseConfigured && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Megaphone className="h-5 w-5 text-brand-700" />
            <h2 className="text-base font-semibold text-gray-900">Announcements</h2>
          </div>

          {/* Create form */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 space-y-3">
            <textarea
              value={newMsg}
              onChange={(e) => setNewMsg(e.target.value)}
              placeholder="Announcement message…"
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-700/20 resize-none"
            />
            <div className="flex flex-wrap gap-3">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'info' | 'warning' | 'success')}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-700/20"
              >
                <option value="info">Info (blue)</option>
                <option value="warning">Warning (amber)</option>
                <option value="success">Success (green)</option>
              </select>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Publish at</label>
                <input
                  type="datetime-local"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-700/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Expires</label>
                <input
                  type="datetime-local"
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-700/20"
                />
              </div>
              <button
                onClick={createAnnouncement}
                disabled={saving || !newMsg.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-700 text-white text-sm font-medium rounded-lg hover:bg-brand-800 transition-colors disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Post
              </button>
            </div>
          </div>

          {/* List */}
          {announcements.length === 0 ? (
            <p className="text-sm text-gray-400">No announcements yet.</p>
          ) : (
            <div className="space-y-2">
              {announcements.map((a) => (
                <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 mt-0.5 ${TYPE_COLORS[a.type]}`}>
                    {a.type}
                  </span>
                  <p className={`text-sm flex-1 ${a.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                    {a.message}
                  </p>
                  {a.starts_at && new Date(a.starts_at) > new Date() && (
                    <span className="text-xs text-amber-600 shrink-0">scheduled {new Date(a.starts_at).toLocaleDateString()}</span>
                  )}
                  {a.expires_at && (
                    <span className="text-xs text-gray-400 shrink-0">exp. {new Date(a.expires_at).toLocaleDateString()}</span>
                  )}
                  <button
                    onClick={() => toggleActive(a.id, a.active)}
                    className="shrink-0 text-gray-400 hover:text-brand-700 transition-colors"
                    title={a.active ? 'Deactivate' : 'Activate'}
                  >
                    {a.active ? <ToggleRight className="h-5 w-5 text-brand-700" /> : <ToggleLeft className="h-5 w-5" />}
                  </button>
                  <button
                    onClick={() => setPendingDelete(a.id)}
                    className="shrink-0 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!supabaseConfigured && (
        <p className="text-sm text-gray-400">
          Announcements and session data require a Supabase database. Settings and categories are managed via Odoo.
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete announcement?"
        message="This removes it from the customer banner. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
