'use client'
import { create } from 'zustand'
import type { Cart, CartLine, Product, PackagingOption } from '@/types'

interface CartState {
  cart: Cart | null
  isLoading: boolean
  odooUnavailable: boolean
  setCart: (cart: Cart | null) => void
  setLoading: (v: boolean) => void
  setUnavailable: (v: boolean) => void
  lineCount: () => number       // unique products (number of lines)
  fetchCart: () => Promise<void>
  // Optimistically merge/append a line so the UI updates instantly while the
  // Odoo write happens in the background. Returns the previous cart so the
  // caller can roll back if the write fails.
  addLineOptimistic: (product: Product, pkg: PackagingOption, qty: number) => Cart | null
}

// Recompute cart totals from its lines after an optimistic mutation.
function withTotals(cart: Cart): Cart {
  const amount_total = cart.lines.reduce((s, l) => s + l.price_total, 0)
  const amount_untaxed = cart.lines.reduce((s, l) => s + l.price_subtotal, 0)
  return {
    ...cart,
    amount_total: Math.round(amount_total * 100) / 100,
    amount_untaxed: Math.round(amount_untaxed * 100) / 100,
    amount_tax: Math.round((amount_total - amount_untaxed) * 100) / 100,
  }
}

export const useCartStore = create<CartState>((set, get) => ({
  cart: null,
  isLoading: false,
  odooUnavailable: false,
  setCart: (cart) => set({ cart }),
  setLoading: (isLoading) => set({ isLoading }),
  setUnavailable: (odooUnavailable) => set({ odooUnavailable }),
  lineCount: () => get().cart?.lines.length ?? 0,
  fetchCart: async () => {
    try {
      const res = await fetch('/api/cart')
      if (!res.ok) return
      const data = await res.json()
      set({ cart: data })
    } catch {
      // silently ignore — badge stays at 0
    }
  },
  addLineOptimistic: (product, pkg, qty) => {
    const prev = get().cart
    // Seed an empty cart if none exists yet (temp id, reconciled on server reply).
    const base: Cart = prev ?? {
      cart_id: -1,
      state: 'draft',
      partner_shipping_id: null,
      partner_shipping_name: '',
      note: '',
      lines: [],
      amount_untaxed: 0,
      amount_tax: 0,
      amount_total: 0,
      currency: product.currency,
      warnings: [],
    }

    const lines = base.lines.map((l) => ({ ...l }))
    const existing = lines.find(
      (l) => l.template_id === product.template_id && l.packaging_id === pkg.id,
    )

    if (existing) {
      const ratio = (existing.packaging_qty + qty) / existing.packaging_qty
      existing.packaging_qty += qty
      existing.unit_qty += qty * pkg.qty
      existing.price_subtotal = Math.round(existing.price_subtotal * ratio * 100) / 100
      existing.price_total = Math.round(existing.price_total * ratio * 100) / 100
    } else {
      const newLine: CartLine = {
        line_id: -Date.now(), // temp negative id until the server reconciles
        product_id: product.variant_id,
        template_id: product.template_id,
        product_name: product.name,
        product_name_he: product.name_he,
        product_image_url: `/api/images/product/${product.template_id}/128`,
        sku: product.sku,
        packaging_id: pkg.id,
        packaging_name: pkg.name,
        packaging_qty: qty,
        unit_qty: qty * pkg.qty,
        price_unit: pkg.price_per_unit_incl_tax,
        price_per_pack: pkg.price_per_pack_incl_tax,
        price_subtotal: Math.round(pkg.price_per_pack_excl_tax * qty * 100) / 100,
        price_total: Math.round(pkg.price_per_pack_incl_tax * qty * 100) / 100,
        warnings: [],
      }
      lines.push(newLine)
    }

    set({ cart: withTotals({ ...base, lines }) })
    return prev
  },
}))
