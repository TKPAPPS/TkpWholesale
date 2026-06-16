'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Eye, EyeOff, Save, RotateCw } from 'lucide-react'
import {
  type SiteSettings, SITE_SETTINGS_BOUNDS,
} from '@/lib/site-settings'

interface PortalSettings {
  hide_out_of_stock: boolean
}

const RULE_FIELDS: { key: keyof SiteSettings; label: string; help: string }[] = [
  { key: 'lowStockThreshold', label: 'Low-stock badge below', help: 'Show the "Low stock" badge when available quantity is under this number.' },
  { key: 'newArrivalsDays', label: 'New arrivals window (days)', help: 'How many days back the New Arrivals page includes.' },
  { key: 'productsPerPage', label: 'Products per page', help: 'Page size of the product grid.' },
  { key: 'ordersPerPage', label: 'Orders per page', help: 'Page size of the orders list.' },
  { key: 'invoicesPerPage', label: 'Invoices per page', help: 'Page size of the invoices list.' },
  { key: 'checkoutNoteMaxLength', label: 'Checkout note max length', help: 'Maximum characters for the order note at checkout.' },
]

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
  const router = useRouter()

  // Hide-out-of-stock toggle (Odoo b2b_portal.hide_out_of_stock)
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [draft, setDraft] = useState<PortalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Storefront rules (Odoo b2b_portal.site_settings)
  const [rules, setRules] = useState<SiteSettings | null>(null)
  const [rulesDraft, setRulesDraft] = useState<SiteSettings | null>(null)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesSaved, setRulesSaved] = useState(false)
  const [rulesError, setRulesError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/settings')
      if (res.status === 401) { router.replace('/admin/login'); return }
      if (!res.ok) throw new Error()
      const d = await res.json()
      setSettings(d)
      setDraft(d)
    } catch {
      setError('Could not load settings from Odoo.')
    } finally {
      setLoading(false)
    }
  }, [router])

  const loadRules = useCallback(async () => {
    setRulesError('')
    try {
      const res = await fetch('/api/admin/site-settings')
      if (res.status === 401) { router.replace('/admin/login'); return }
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRules(d)
      setRulesDraft(d)
    } catch {
      setRulesError('Could not load storefront rules from Odoo.')
    }
  }, [router])

  useEffect(() => { load(); loadRules() }, [load, loadRules])

  const dirty = JSON.stringify(settings) !== JSON.stringify(draft)
  const rulesDirty = JSON.stringify(rules) !== JSON.stringify(rulesDraft)

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
      if (res.status === 401) { router.replace('/admin/login'); return }
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

  const saveRules = async () => {
    if (!rulesDraft) return
    setRulesSaving(true)
    setRulesError('')
    try {
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rulesDraft),
      })
      if (res.status === 401) { router.replace('/admin/login'); return }
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      // The server clamps to allowed bounds and returns the saved values.
      setRules(data.settings)
      setRulesDraft(data.settings)
      setRulesSaved(true)
      setTimeout(() => setRulesSaved(false), 2500)
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Could not save rules.')
    } finally {
      setRulesSaving(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>

      {loading && <p className="text-sm text-gray-400">Loading settings…</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {error && !draft && !loading && (
        <button onClick={load} className="inline-flex items-center gap-2 text-sm text-brand-700 hover:underline mb-4">
          <RotateCw className="h-4 w-4" /> Retry
        </button>
      )}

      <div className="space-y-6 max-w-lg">
        {/* Catalog behaviour */}
        {draft && (
          <div className="space-y-4">
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

        {/* Storefront rules */}
        {rulesError && !rulesDraft && (
          <button onClick={loadRules} className="inline-flex items-center gap-2 text-sm text-brand-700 hover:underline">
            <RotateCw className="h-4 w-4" /> Retry loading storefront rules
          </button>
        )}
        {rulesDraft && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Storefront rules</h2>
              <p className="text-xs text-gray-400 mb-4">Tune how the customer storefront behaves. Changes apply within a few minutes.</p>
              <div className="space-y-4">
                {RULE_FIELDS.map((f) => {
                  const bounds = SITE_SETTINGS_BOUNDS[f.key]
                  return (
                    <div key={f.key} className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{f.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{f.help}</p>
                      </div>
                      <input
                        type="number"
                        min={bounds.min}
                        max={bounds.max}
                        value={rulesDraft[f.key]}
                        onChange={(e) => setRulesDraft({ ...rulesDraft, [f.key]: Number(e.target.value) })}
                        className="w-24 shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-end focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700/20"
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {rulesError && rulesDraft && <p className="text-sm text-red-600">{rulesError}</p>}
            <div className="flex items-center gap-3">
              <Button onClick={saveRules} loading={rulesSaving} disabled={!rulesDirty}>
                <Save className="h-4 w-4 me-2" />
                {rulesSaved ? 'Saved!' : 'Save rules'}
              </Button>
              {rulesDirty && !rulesSaving && (
                <button onClick={() => setRulesDraft(rules)} className="text-sm text-gray-400 hover:text-gray-600">
                  Discard
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
