'use client'
import { useEffect, useState } from 'react'
import { X, Info, AlertTriangle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Announcement {
  id: number
  message: string
  type: 'info' | 'warning' | 'success'
}

const STYLES = {
  info:    { bg: 'bg-blue-50 border-blue-100',    text: 'text-blue-800',  Icon: Info },
  warning: { bg: 'bg-amber-50 border-amber-100',  text: 'text-amber-800', Icon: AlertTriangle },
  success: { bg: 'bg-green-50 border-green-100',  text: 'text-green-800', Icon: CheckCircle },
}

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(d => {
        if (d.announcement) {
          const key = `dismissed-announcement-${d.announcement.id}`
          if (!localStorage.getItem(key)) setAnnouncement(d.announcement)
        }
      })
      .catch(() => {})
  }, [])

  if (!announcement || dismissed) return null

  const { bg, text, Icon } = STYLES[announcement.type] ?? STYLES.info

  const dismiss = () => {
    localStorage.setItem(`dismissed-announcement-${announcement.id}`, '1')
    setDismissed(true)
  }

  return (
    <div className={cn('border-b px-4 sm:px-6 lg:px-8 py-2.5', bg)}>
      <div className="mx-auto max-w-screen-xl flex items-center gap-3">
        <Icon className={cn('h-4 w-4 shrink-0', text)} />
        <p className={cn('text-sm flex-1', text)}>{announcement.message}</p>
        <button onClick={dismiss} className={cn('shrink-0 opacity-60 hover:opacity-100 transition-opacity', text)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
