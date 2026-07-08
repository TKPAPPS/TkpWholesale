'use client'
import { useEffect, useState } from 'react'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToastStore } from '@/store/toastStore'
import { WEEKDAY_SHORT_EN, WEEKDAY_SHORT_HE, type ScheduledOrderView } from '@/lib/scheduled-orders'
import { CalendarClock, Pause, Play, Trash2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

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

  const frequencyLabel = (s: ScheduledOrderView): string => {
    if (s.frequency === 'daily') {
      if (s.excluded_weekdays.length === 0) return t(lang, 'scheduled.daily')
      const labels = lang === 'he' ? WEEKDAY_SHORT_HE : WEEKDAY_SHORT_EN
      return `${t(lang, 'scheduled.dailyExcept')} ${s.excluded_weekdays.map((d) => labels[d]).join(', ')}`
    }
    if (s.interval_weeks === 1) return t(lang, 'scheduled.everyWeek')
    return t(lang, 'scheduled.everyNWeeks').replace('{n}', String(s.interval_weeks))
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
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t(lang, 'scheduled.nextRun')}: <span className="font-medium">{paused ? '—' : s.next_run_date}</span>
                      {s.end_date && <> · {t(lang, 'scheduled.ends')} {s.end_date}</>}
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
        destructive
        busy={busyId === cancelId}
        onConfirm={doCancel}
        onCancel={() => setCancelId(null)}
      />
    </div>
  )
}
