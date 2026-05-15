'use client'
import { useLangStore } from '@/store/langStore'

export function LanguageSwitcher() {
  const { lang, setLang } = useLangStore()
  return (
    <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
      <button
        onClick={() => setLang('en')}
        className={`px-2.5 py-1.5 transition-colors ${lang === 'en' ? 'bg-brand-700 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
      >
        EN
      </button>
      <button
        onClick={() => setLang('he')}
        className={`px-2.5 py-1.5 transition-colors ${lang === 'he' ? 'bg-brand-700 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
      >
        עב
      </button>
    </div>
  )
}
