'use client'
import { Heart } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface FavoriteButtonProps {
  templateId: number
  initialFavorited?: boolean
  className?: string
}

export function FavoriteButton({ templateId, initialFavorited = false, className }: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(initialFavorited)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    setLoading(true)
    try {
      if (favorited) {
        await fetch(`/api/favorites/${templateId}`, { method: 'DELETE' })
        setFavorited(false)
      } else {
        await fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: templateId }) })
        setFavorited(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); toggle() }}
      disabled={loading}
      className={cn('flex items-center justify-center h-8 w-8 rounded-full hover:bg-gray-100 transition-colors', className)}
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart className={cn('h-4 w-4 transition-colors', favorited ? 'fill-red-500 text-red-500' : 'text-gray-400')} />
    </button>
  )
}
