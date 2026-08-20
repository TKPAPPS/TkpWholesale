// Shared types + validation for scheduled / repeating orders. Import-safe on both
// server and client (no server-only imports).

import { todayBkk } from '@/lib/schedule-dates'

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
  excluded_weekdays?: number[]  // daily only, 0=Sun..6=Sat
  end_date?: string | null      // 'YYYY-MM-DD' or null
}

// A schedule as returned to the management UI.
export interface ScheduledOrderView {
  id: string
  frequency: ScheduleFrequency
  interval_weeks: number
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
export function normalizeScheduleInput(raw: unknown): { ok: true; value: Required<Omit<ScheduleInput, 'end_date'>> & { end_date: string | null } } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Missing schedule.' }
  const s = raw as Record<string, unknown>

  if (s.frequency !== 'daily' && s.frequency !== 'weekly') {
    return { ok: false, error: 'Invalid frequency.' }
  }

  let interval_weeks = 1
  let excluded_weekdays: number[] = []

  if (s.frequency === 'weekly') {
    interval_weeks = Number(s.interval_weeks ?? 1)
    if (!Number.isInteger(interval_weeks) || interval_weeks < 1 || interval_weeks > 8) {
      return { ok: false, error: 'Interval must be between 1 and 8 weeks.' }
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
    if (typeof s.end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.end_date) || Number.isNaN(Date.parse(s.end_date))) {
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

  return { ok: true, value: { frequency: s.frequency, interval_weeks, excluded_weekdays, end_date } }
}

// Human-readable weekday short names (Sun..Sat), for the UI + emails.
export const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_SHORT_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
