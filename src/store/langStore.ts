'use client'
import { create } from 'zustand'
import type { Lang } from '@/lib/i18n/translations'
import { getLangCookie, setLangCookie } from '@/lib/utils'

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLangStore = create<LangState>((set) => ({
  lang: 'en',
  setLang: (lang) => {
    setLangCookie(lang)
    set({ lang })
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
    document.documentElement.setAttribute('data-font', lang === 'he' ? 'hebrew' : 'sans')
  },
}))

export function initLang() {
  const lang = getLangCookie()
  useLangStore.getState().setLang(lang)
}
