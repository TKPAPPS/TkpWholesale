'use client'
import { useEffect, useState } from 'react'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToastStore } from '@/store/toastStore'
import { cadenceLabel, humanDate, windowSentence, type ScheduledOrderView } from '@/lib/scheduled-orders'
import { nextRunDate, addDays } from '@/lib/schedule-dates'
import { CalendarClock, Pause, Play, Trash2, AlertTriangle, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export default function ScheduledOrdersPage() {
  const { lang } = useLangStore()
  const showToast = useToastStore((s) => s.show)
  const [schedules, setSchedules] = useState<ScheduledOrderView[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/scheduled-orders')
      if (!res.ok) { setSchedules([]); return }
      const data = await res.json()
      setSchedules(data.schedules ?? [])
    } catch {
      setSchedules([])
    }
  }

  useEffect(() => { load() }, [])

  const searchParams = useSearchParams()
  const justCreated = searchParams.get('created') === '1'

  const frequencyLabel = (s: ScheduledOrderView): string =>
    cadenceLabel({ frequency: s.frequency, interval_weeks: s.interval_weeks, excluded_weekdays: s.excluded_weekdays, weekday: s.weekday }, lang)

  // The next few real order dates, from next_run_date forward.
  const upcomingDates = (s: ScheduledOrderView, count = 4): string[] => {
    const spec = { frequency: s.frequency, interval_weeks: s.interval_weeks, excluded_weekdays: s.excluded_weekdays, weekday: s.weekday, anchor_date: s.anchor_date, end_date: s.end_date }
    const out: string[] = []
    let d: string | null = s.next_run_date
    let guard = 0
    while (d && out.length < count && guard < 30) {
      out.push(d)
      d = nextRunDate(spec, d)
      guard++
    }
    return out
  }

  const setStatus = async (id: string, action: 'pause' | 'resume') => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/scheduled-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      showToast('Could not update the schedule. Please try again.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const doCancel = async () => {
    if (!cancelId) return
    setBusyId(cancelId)
    try {
      const res = await fetch(`/api/scheduled-orders/${cancelId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setCancelId(null)
      await load()
    } catch {
      showToast('Could not cancel the schedule. Please try again.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  if (schedules === null) return <LoadingSpinner />

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">{t(lang, 'scheduled.title')}</h1>

      {justCreated && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-green-800">{t(lang, 'scheduled.createdTitle')}</p>
            <p className="text-xs text-green-700 mt-0.5">{t(lang, 'scheduled.createdBody')}</p>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-12 w-12" />}
          title={t(lang, 'scheduled.empty')}
          description={t(lang, 'scheduled.emptyHint')}
          action={<Link href="/products" className="text-sm text-brand-700 hover:underline">{t(lang, 'nav.products')}</Link>}
        />
      ) : (
        <div className="space-y-4">
          {schedules.map((s) => {
            const paused = s.status === 'paused'
            const failing = s.consecutive_failures > 0
            return (
              <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{frequencyLabel(s)}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {t(lang, 'scheduled.nextRun')}: <span className="font-medium">{paused ? t(lang, 'scheduled.paused') : humanDate(s.next_run_date, lang)}</span>
                      {s.end_date && <> · {t(lang, 'scheduled.ends')} {humanDate(s.end_date, lang)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {paused
                      ? <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{t(lang, 'scheduled.paused')}</span>
                      : failing && <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{t(lang, 'scheduled.failing')}</span>}
                  </div>
                </div>

                {/* Items */}
                <ul className="mt-3 text-sm text-gray-600 space-y-0.5">
                  {s.items.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span className="truncate">{lang === 'he' ? i.name_he : i.name}</span>
                      <span className="text-gray-400 shrink-0">× {i.packaging_qty || i.uom_qty}</span>
                    </li>
                  ))}
                </ul>

                {!paused && (
                  <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{t(lang, 'scheduled.upcoming')}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {upcomingDates(s).map((d) => (
                        <span key={d} className="text-sm text-gray-800">{humanDate(d, lang)}</span>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">{windowSentence(lang)}</p>
                  </div>
                )}

                {s.last_order_name && (
                  <p className="text-xs text-gray-400 mt-3">
                    {t(lang, 'scheduled.lastOrder')}: {s.last_order_id
                      ? <Link href={`/orders/${s.last_order_id}`} className="text-brand-700 hover:underline">{s.last_order_name}</Link>
                      : s.last_order_name}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-50">
                  {paused ? (
                    <button
                      onClick={() => setStatus(s.id, 'resume')}
                      disabled={busyId === s.id}
                      className="flex items-center gap-1.5 text-sm text-brand-700 hover:bg-brand-50 rounded-lg px-3 py-1.5 disabled:opacity-50"
                    ><Play className="h-4 w-4" />{t(lang, 'scheduled.resume')}</button>
                  ) : (
                    <button
                      onClick={() => setStatus(s.id, 'pause')}
                      disabled={busyId === s.id}
                      className="flex items-center gap-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg px-3 py-1.5 disabled:opacity-50"
                    ><Pause className="h-4 w-4" />{t(lang, 'scheduled.pause')}</button>
                  )}
                  <button
                    onClick={() => setCancelId(s.id)}
                    disabled={busyId === s.id}
                    className="flex items-center gap-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 disabled:opacity-50"
                  ><Trash2 className="h-4 w-4" />{t(lang, 'scheduled.cancel')}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={cancelId !== null}
        title={t(lang, 'scheduled.cancel')}
        message={t(lang, 'scheduled.cancelConfirm')}
        confirmLabel={t(lang, 'scheduled.cancel')}
        cancelLabel={t(lang, 'common.close')}
        busyLabel={t(lang, 'common.working')}
        destructive
        busy={busyId === cancelId}
        onConfirm={doCancel}
        onCancel={() => setCancelId(null)}
      />
    </div>
  )
}
