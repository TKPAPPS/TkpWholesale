'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Save } from 'lucide-react'

type Slug = 'terms' | 'privacy' | 'contact'
type ContentMap = Record<Slug, { en: string; he: string }>

const SLUGS: Slug[] = ['terms', 'privacy', 'contact']
const EMPTY: ContentMap = { terms: { en: '', he: '' }, privacy: { en: '', he: '' }, contact: { en: '', he: '' } }

export default function ContentPage() {
  const [content, setContent] = useState<ContentMap>(EMPTY)
  const [original, setOriginal] = useState<ContentMap>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/content')
      .then((r) => r.json())
      .then((d) => { setContent(d); setOriginal(d) })
      .catch(() => setError('Could not load content from Odoo.'))
      .finally(() => setLoading(false))
  }, [])

  const dirty = JSON.stringify(content) !== JSON.stringify(original)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      })
      if (!res.ok) throw new Error()
      setOriginal(content)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save. Check Odoo connectivity.')
    } finally {
      setSaving(false)
    }
  }

  const update = (slug: Slug, lang: 'en' | 'he', value: string) => {
    setContent((prev) => ({ ...prev, [slug]: { ...prev[slug], [lang]: value } }))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Content</h1>
        <div className="flex items-center gap-3">
          <Button onClick={save} loading={saving} disabled={!dirty || loading}>
            <Save className="h-4 w-4 me-2" />
            {saved ? 'Saved!' : 'Save changes'}
          </Button>
          {dirty && !saving && (
            <button onClick={() => setContent(original)} className="text-sm text-gray-400 hover:text-gray-600">
              Discard
            </button>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {!loading && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-2xl space-y-8">
          {SLUGS.map((slug) => (
            <div key={slug}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 capitalize border-b border-gray-100 pb-2">{slug}</h2>
              <label className="block text-xs font-medium text-gray-500 mb-1">English</label>
              <textarea
                rows={5}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                value={content[slug].en}
                onChange={(e) => update(slug, 'en', e.target.value)}
              />
              <label className="block text-xs font-medium text-gray-500 mb-1 mt-3">Hebrew</label>
              <textarea
                rows={5}
                dir="rtl"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                value={content[slug].he}
                onChange={(e) => update(slug, 'he', e.target.value)}
              />
            </div>
          ))}
          <p className="text-xs text-gray-400">Stored in Odoo system parameters.</p>
        </div>
      )}
    </div>
  )
}
