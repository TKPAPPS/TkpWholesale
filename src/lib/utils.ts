import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

// Parse a date string into a Date.
// Odoo datetime fields come back as naive UTC "YYYY-MM-DD HH:MM:SS" (no zone
// marker). new Date() parses that form inconsistently - Invalid Date on Safari,
// browser-local elsewhere - so normalize it to an explicit UTC ISO string first.
// Already-ISO strings (with 'T' and/or 'Z') are passed through unchanged.
function parseOdooDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z')
  }
  return new Date(value)
}

export function formatDate(iso: string, lang: 'en' | 'he'): string {
  return parseOdooDate(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

export function getLangCookie(): 'en' | 'he' {
  if (typeof document === 'undefined') return 'en'
  const match = document.cookie.match(/(?:^|;\s*)lang=([^;]*)/)
  return (match?.[1] as 'en' | 'he') || 'en'
}

export function setLangCookie(lang: 'en' | 'he') {
  document.cookie = `lang=${lang}; path=/; max-age=${365 * 24 * 3600}; SameSite=Lax`
}

// Whether a language cookie already exists. Must be checked BEFORE initLang()
// (which writes the cookie): it distinguishes a first-ever visit (no cookie,
// Odoo profile lang may apply) from a returning user whose choice must win.
export function hasLangCookie(): boolean {
  if (typeof document === 'undefined') return false
  return /(?:^|;\s*)lang=(en|he)(?:;|$)/.test(document.cookie)
}

// Client-side mirror of the server's stock cap (defense-in-depth UX only - the server
// always re-validates on add/update). Returns undefined when there is NO limit.
//
// `allowOos` is the merchant's explicit "Continue Selling if Out of Stock" tick, and it means
// UNLIMITED: order any quantity regardless of the real stock level. It must be passed in, not
// inferred. This function used to derive it from `!inStock`, which is only equivalent when
// stock is exactly zero, so an allow-OOS product with a little stock got capped by the very
// stock it was supposed to ignore: 0.325 kg floored to 0 and rendered SOLD OUT, and 1.205 kg
// silently capped the customer at 1. The 79 such products that behaved correctly did so only
// because they happened to hold zero.
export function computeMaxPacks(
  inStock: boolean,
  qtyAvailable: number,
  packQty: number,
  allowOos = false,
): number | undefined {
  if (allowOos) return undefined
  if (!inStock || qtyAvailable <= 0 || packQty <= 0) return undefined
  return Math.floor(qtyAvailable / packQty)
}
