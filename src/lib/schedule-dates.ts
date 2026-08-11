// Bangkok-safe date helpers. The business runs in Asia/Bangkok (UTC+7, no DST),
// so "today", delivery-date bounds, and recurrence math must all be computed in
// that zone - never via new Date().toISOString() (UTC) or new Date('YYYY-MM-DD')
// (parsed as browser-local). All functions operate on 'YYYY-MM-DD' strings and
// are pure, so they behave identically on the server and in the browser.

const BKK_OFFSET_MS = 7 * 3600 * 1000

// 0 = Sunday .. 6 = Saturday
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

// Today's calendar date in Asia/Bangkok, as 'YYYY-MM-DD'.
export function todayBkk(now: number = Date.now()): string {
  return new Date(now + BKK_OFFSET_MS).toISOString().slice(0, 10)
}

// Add (or subtract) whole days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'.
// Uses UTC arithmetic on the parsed date so it is DST- and locale-independent.
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * 86400 * 1000
  return new Date(t).toISOString().slice(0, 10)
}

// Weekday of a 'YYYY-MM-DD' string (0 = Sun .. 6 = Sat), timezone-independent.
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday
}

// String comparison works for 'YYYY-MM-DD' because the format is zero-padded and
// lexically ordered. These helpers make intent explicit at call sites.
export function isBefore(a: string, b: string): boolean {
  return a < b
}
export function isAfter(a: string, b: string): boolean {
  return a > b
}

export interface RecurrenceSpec {
  frequency: 'daily' | 'weekly'
  interval_weeks: number // weekly only; 1 = every week, N = every N weeks
  excluded_weekdays: number[] // daily only; 0..6
  anchor_date: string // 'YYYY-MM-DD' - the checkout date the schedule was created on
  end_date?: string | null // inclusive; null/undefined = no end
}

// Next run strictly after `after`. Returns null when the schedule has ended
// (past end_date) or a daily schedule excludes every weekday.
export function nextRunDate(spec: RecurrenceSpec, after: string): string | null {
  let d: string

  if (spec.frequency === 'daily') {
    const excluded = new Set(spec.excluded_weekdays)
    if (excluded.size >= 7) return null // all days excluded - no valid run
    d = addDays(after, 1)
    let guard = 0
    while (excluded.has(weekdayOf(d))) {
      d = addDays(d, 1)
      if (++guard > 7) return null
    }
  } else {
    // weekly / every-N-weeks, anchored to anchor_date's weekday.
    // Stepping from the anchor (not from `now`) means late or failed runs never
    // drift the cadence.
    const step = Math.max(1, spec.interval_weeks) * 7
    d = spec.anchor_date
    let guard = 0
    while (!isAfter(d, after)) {
      d = addDays(d, step)
      if (++guard > 520) return null // ~10 years of weekly steps - safety cap
    }
  }

  if (spec.end_date && isAfter(d, spec.end_date)) return null
  return d
}
