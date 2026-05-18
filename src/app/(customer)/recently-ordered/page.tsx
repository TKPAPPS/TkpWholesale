'use client'
import { useEffect, useState } from 'react'
import { Product } from '@/types'
import { useLangStore } from '@/store/langStore'
import { t } from '@/lib/i18n/translations'
import { ProductCard } from '@/components/products/ProductCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Clock } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default function RecentlyOrderedPage() {
  const { lang } = useLangStore()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/recently-ordered')
      .then((r) => r.json())
      .then((d) => setProducts(d.products ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">{t(lang, 'recent.title')}</h1>
      {products.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-12 w-12" />}
          title={t(lang, 'recent.empty')}
          action={<Link href="/products"><Button variant="secondary">Browse Products</Button></Link>}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  )
}
