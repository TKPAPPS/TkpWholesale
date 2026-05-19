'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Eye, EyeOff, Save } from 'lucide-react'

interface PortalSettings {
  hide_out_of_stock: boolean
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-700/30 disabled:opacity-50 ${checked ? 'bg-brand-700' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [draft, setDraft] = useState<PortalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => { setSettings(d); setDraft(d) })
      .catch(() => setError('Could not load settings from Odoo.'))
      .finally(() => setLoading(false))
  }, [])

  const dirty = JSON.stringify(settings) !== JSON.stringify(draft)

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      setSettings(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>

      {loading && <p className="text-sm text-gray-400">Loading settings…</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {draft && (
        <div className="space-y-4 max-w-lg">
          {/* Catalog behaviour */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Product Catalog</h2>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                  {draft.hide_out_of_stock ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                  Hide out-of-stock products
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {draft.hide_out_of_stock
                    ? 'Out-of-stock products are hidden unless "Continue Selling" is enabled for this website.'
                    : 'All published products are shown regardless of stock level.'}
                </p>
              </div>
              <Toggle
                checked={draft.hide_out_of_stock}
                onChange={(v) => setDraft({ ...draft, hide_out_of_stock: v })}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save className="h-4 w-4 me-2" />
              {saved ? 'Saved!' : 'Save changes'}
            </Button>
            {dirty && !saving && (
              <button onClick={() => setDraft(settings)} className="text-sm text-gray-400 hover:text-gray-600">
                Discard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
