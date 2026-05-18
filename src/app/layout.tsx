export const preferredRegion = 'sin1'

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'

export const metadata: Metadata = {
  title: 'B2B Ordering Portal',
  description: 'Private B2B ordering portal',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (cookies().get('lang')?.value as 'en' | 'he') || 'en'
  const dir = lang === 'he' ? 'rtl' : 'ltr'

  return (
    <html lang={lang} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Rubik:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: lang === 'he' ? "'Rubik', sans-serif" : "'Inter', sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
