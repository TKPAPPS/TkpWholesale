'use client'
import { useLangStore } from '@/store/langStore'

export function LanguageSwitcher() {
  const { lang, setLang } = useLangStore()
  return (
    <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
      <button
        onClick={() => setLang('en')}
        className={`px-2.5 py-1.5 transition-colors ${lang === 'en' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
      >
        EN
      </button>
      <button
        onClick={() => setLang('he')}
        className={`px-2.5 py-1.5 transition-colors ${lang === 'he' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
      >
        עב
      </button>
    </div>
  )
}
