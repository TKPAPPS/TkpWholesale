import { Cart } from '@/types'
import { useLangStore } from '@/store/langStore'
import { formatCurrency } from '@/lib/utils'
import { t } from '@/lib/i18n/translations'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'

interface CartSummaryProps {
  cart: Cart
  showCheckoutButton?: boolean
}

export function CartSummary({ cart, showCheckoutButton = true }: CartSummaryProps) {
  const { lang } = useLangStore()
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
      <div className="flex justify-between text-sm text-gray-600">
        <span>{t(lang, 'cart.subtotal')}</span>
        <span>{formatCurrency(cart.amount_untaxed, cart.currency)}</span>
      </div>
      <div className="flex justify-between text-sm text-gray-600">
        <span>{t(lang, 'cart.tax')}</span>
        <span>{formatCurrency(cart.amount_tax, cart.currency)}</span>
      </div>
      <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-3">
        <span>{t(lang, 'cart.total')}</span>
        <span>{formatCurrency(cart.amount_total, cart.currency)}</span>
      </div>
      {showCheckoutButton && (
        <Link href="/checkout">
          <Button className="w-full mt-2" size="lg">
            {t(lang, 'cart.checkout')}
          </Button>
        </Link>
      )}
    </div>
  )
}
