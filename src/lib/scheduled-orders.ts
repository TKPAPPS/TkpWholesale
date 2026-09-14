// Shared types + validation for scheduled / repeating orders. Import-safe on both
// server and client (no server-only imports).

import { todayBkk, isIsoDate } from '@/lib/schedule-dates'

export interface ScheduledOrderItem {
  product_id: number      // product.product (variant) id
  name: string
  name_he: string
  sku: string
  uom_qty: number
  packaging_id: number | null
  packaging_qty: number
}

export type ScheduleFrequency = 'daily' | 'weekly'
export type ScheduleStatus = 'active' | 'paused' | 'ended' | 'cancelled'

// The recurrence config a customer submits at checkout.
export interface ScheduleInput {
  frequency: ScheduleFrequency
  interval_weeks?: number       // weekly only, 1..8
  weekday?: number              // weekly only, 0=Sun..6=Sat - the day the order is placed on
  excluded_weekdays?: number[]  // daily only, 0=Sun..6=Sat
  end_date?: string | null      // 'YYYY-MM-DD' or null
}

// A schedule as returned to the management UI.
export interface ScheduledOrderView {
  id: string
  frequency: ScheduleFrequency
  interval_weeks: number
  weekday: number | null
  excluded_weekdays: number[]
  anchor_date: string
  end_date: string | null
  next_run_date: string
  status: ScheduleStatus
  paused_reason: string | null
  consecutive_failures: number
  items: ScheduledOrderItem[]
  po_ref: string
  last_order_id: number | null
  last_order_name: string | null
  last_status: string | null
}

export const MAX_ACTIVE_SCHEDULES = 10
export const AUTO_PAUSE_AFTER_FAILURES = 3

// Validate + normalize a checkout ScheduleInput. Returns the clean object or an
// error string. Kept pure so it runs identically on the client (pre-submit) and
// the server (authoritative).
export function normalizeScheduleInput(raw: unknown): { ok: true; value: Required<Omit<ScheduleInput, 'end_date' | 'weekday'>> & { end_date: string | null; weekday: number | null } } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Missing schedule.' }
  const s = raw as Record<string, unknown>

  if (s.frequency !== 'daily' && s.frequency !== 'weekly') {
    return { ok: false, error: 'Invalid frequency.' }
  }

  let interval_weeks = 1
  let excluded_weekdays: number[] = []
  let weekday: number | null = null

  if (s.frequency === 'weekly') {
    interval_weeks = Number(s.interval_weeks ?? 1)
    if (!Number.isInteger(interval_weeks) || interval_weeks < 1 || interval_weeks > 8) {
      return { ok: false, error: 'Interval must be between 1 and 8 weeks.' }
    }
    // The weekday is explicit. It used to be implied by the day the customer happened to
    // check out on, which the UI never said - "Weekly" on a Monday silently meant "every
    // Monday". A customer must pick it, and every screen names it.
    if (s.weekday === undefined || s.weekday === null) {
      return { ok: false, error: 'Choose the day of the week for the order.' }
    }
    weekday = Number(s.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, error: 'Invalid weekday.' }
    }
  } else {
    const arr = Array.isArray(s.excluded_weekdays) ? s.excluded_weekdays : []
    excluded_weekdays = Array.from(new Set(arr.map(Number))).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    if (excluded_weekdays.length >= 7) {
      return { ok: false, error: 'You cannot exclude every day of the week.' }
    }
  }

  let end_date: string | null = null
  if (s.end_date !== undefined && s.end_date !== null && s.end_date !== '') {
    if (typeof s.end_date !== 'string' || !isIsoDate(s.end_date)) {
      return { ok: false, error: 'End date is invalid.' }
    }
    // An end date of today or earlier can never produce a run: nextRunDate() returns the
    // first date strictly AFTER the anchor, so the earliest possible run is tomorrow.
    // Rejected here rather than downstream because createSchedule() only discovers this
    // AFTER the (non-reversible) order is placed, leaving the customer with a soft
    // schedule_error and no recurrence. This catches the obvious case with a clear message;
    // the caller additionally checks nextRunDate() for the ones only the cadence can reveal
    // (e.g. a weekly schedule whose end date falls before its first run).
    if (s.end_date <= todayBkk()) {
      return { ok: false, error: 'End date must be in the future.' }
    }
    end_date = s.end_date
  }

  return { ok: true, value: { frequency: s.frequency, interval_weeks, weekday, excluded_weekdays, end_date } }
}

// Human-readable weekday short names (Sun..Sat), for the UI + emails.
export const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_SHORT_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
export const WEEKDAY_LONG_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_LONG_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// How many days ahead the portal keeps CONFIRMED orders in Odoo for a repeating order.
// Stated to customers and to Odoo staff in those exact terms, so keep the wording in
// sync with cadenceLabel / windowSentence below if this changes.
export const SCHED_WINDOW_DAYS = 7

// "Tue 15 Sep" / "ג׳ 15 בספט׳" style, from a YYYY-MM-DD string, no timezone maths.
export function humanDate(iso: string, lang: 'en' | 'he'): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (lang === 'he') {
    const he = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
    return `יום ${WEEKDAY_LONG_HE[dow]} ${he}`
  }
  return `${WEEKDAY_SHORT_EN[dow]} ${d} ${MONTH_SHORT_EN[m - 1]}`
}

// The one sentence that says what the cadence IS. Identical on the checkout preview, the
// confirmation screen, the Scheduled Orders card, the emails and (in English) the Odoo
// order itself, so nobody has to translate one screen's wording into another's.
export function cadenceLabel(
  s: { frequency: ScheduleFrequency; interval_weeks: number; excluded_weekdays: number[]; weekday?: number | null },
  lang: 'en' | 'he',
): string {
  if (s.frequency === 'daily') {
    const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => !s.excluded_weekdays.includes(d)) // Mon..Sun order
    const names = lang === 'he' ? WEEKDAY_LONG_HE : WEEKDAY_SHORT_EN
    if (days.length === 7) return lang === 'he' ? 'כל יום' : 'Every day'
    const list = days.map((d) => names[d]).join(lang === 'he' ? ', ' : ', ')
    return lang === 'he' ? `בכל יום ${list}` : `Every ${list}`
  }
  const wd = s.weekday ?? 1
  const dayName = (lang === 'he' ? WEEKDAY_LONG_HE : WEEKDAY_LONG_EN)[wd]
  if (s.interval_weeks <= 1) return lang === 'he' ? `כל שבוע ביום ${dayName}` : `Every week on ${dayName}`
  return lang === 'he' ? `כל ${s.interval_weeks} שבועות ביום ${dayName}` : `Every ${s.interval_weeks} weeks on ${dayName}`
}

// The one sentence that says what happens in Odoo and when.
export function windowSentence(lang: 'en' | 'he'): string {
  return lang === 'he'
    ? `ההזמנות ל-${SCHED_WINDOW_DAYS} הימים הבאים כבר קיימות במערכת כהזמנות מאושרות. בכל בוקר ב-06:30 נוספת ההזמנה של היום הבא.`
    : `The next ${SCHED_WINDOW_DAYS} days of orders are already in the system as confirmed orders. Each morning at 06:30 the following day's order is added.`
}
