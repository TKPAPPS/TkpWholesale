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
  // `showLoading` is opt-in and meant only for a page's initial load (the cart page). A
  // background resync must not flip the global spinner.
  fetchCart: (opts?: { showLoading?: boolean }) => Promise<void>
  // Optimistically merge/append a line so the UI updates instantly while the
  // Odoo write happens in the background. Returns the previous cart so the
  // caller can roll back if the write fails.
  addLineOptimistic: (product: Product, pkg: PackagingOption, qty: number) => Cart | null
  // Optimistic add + background POST + sequenced reconcile. Resolves { ok: true } on
  // success - with `adjustedPacks` set if the server clamped the requested quantity down
  // to what's available (e.g. asked for 50, only 37 in stock - added 37). On failure
  // (after resyncing), { ok: false, message } carries the server's reason (there's a
  // genuine reject only when literally nothing more can be added). Shared by the product
  // grid and the product detail page so both stay on one cart-sync protocol.
  addToCartAndSync: (product: Product, pkg: PackagingOption, qty: number) => Promise<{ ok: boolean; message?: string; adjustedPacks?: number }>
  // Re-add many lines (reorder). Resolves with how many failed.
  reorderLines: (lines: { product_id: number; packaging_id: number | null; packaging_qty: number }[]) => Promise<{ added: number; failed: number }>
  // Update / remove a cart line with sequenced reconcile. No-op on optimistic
  // (negative) line ids, which have no server row yet. See addToCartAndSync for
  // the adjustedPacks / message contract.
  updateLineQty: (lineId: number, packagingQty: number) => Promise<{ ok: boolean; message?: string; adjustedPacks?: number }>
  removeLine: (lineId: number) => Promise<boolean>
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

// Monotonic reconcile sequencing. Every server-bound cart mutation takes a ticket
// before it fires; a server response only replaces the cart if no newer response
// has already landed. Without this, a slower earlier response overwrites a newer
// cart and silently drops items the user just added.
let seqCounter = 0
let appliedSeq = 0
// Number of cart-mutating requests currently in flight. A plain background GET must never
// overwrite the confirmed result of an edit the user just made, even if the GET was
// dispatched later and resolves first.
let inflightMutations = 0

export const useCartStore = create<CartState>((set, get) => {
  // Background refresh (fetchCart). Applies only if it is not stale AND no mutation is in
  // flight - otherwise a GET that raced an add/update would clobber the mutation's result.
  const reconcile = (cart: Cart, seq: number) => {
    if (seq < appliedSeq || inflightMutations > 0) return
    appliedSeq = seq
    set({ cart })
  }
  // A direct mutation's OWN response (add/update/remove line). It wins over a concurrent
  // background GET (see `inflightMutations` in reconcile), because a fast plain GET is not
  // more authoritative than the confirmed result of the edit the user just made (e.g. a
  // server-clamped quantity). It is STILL ordered against other mutations: an older
  // mutation response that lands late must not overwrite a newer one, which is why the
  // staleness check stays here rather than being dropped.
  const applyMutation = (cart: Cart, seq: number) => {
    if (seq < appliedSeq) return
    appliedSeq = seq
    set({ cart })
  }

  // Runs a cart mutation while holding off background refreshes, with exactly ONE release
  // point regardless of which path the mutation exits by. The hold is released BEFORE any
  // resync, because a resync issued while its own mutation still held the lock would be
  // suppressed by reconcile() and the failed optimistic line would never be rolled back.
  // `resync` in the return asks for that post-release refresh.
  const holdMutation = async <T>(fn: () => Promise<{ resync: boolean; result: T }>): Promise<T> => {
    inflightMutations++
    let outcome: { resync: boolean; result: T }
    try {
      outcome = await fn()
    } finally {
      inflightMutations--
    }
    if (outcome.resync) await get().fetchCart()
    return outcome.result
  }

  return {
    cart: null,
    isLoading: false,
    odooUnavailable: false,
    setCart: (cart) => set({ cart }),
    setLoading: (isLoading) => set({ isLoading }),
    setUnavailable: (odooUnavailable) => set({ odooUnavailable }),
    lineCount: () => get().cart?.lines.length ?? 0,
    // Also drives the cart page's loading/error UI (isLoading/odooUnavailable) - it no longer
    // keeps its own separate, unsequenced fetch that could clobber a fresher mutation.
    // `showLoading` is opt-in: only the cart page's initial load should blank the page into a
    // spinner. A background resync (layout mount, badge, post-mutation) must not, or every
    // failed edit would flash the whole cart away and remount each row.
    fetchCart: async (opts?: { showLoading?: boolean }) => {
      if (opts?.showLoading) set({ isLoading: true })
      const seq = ++seqCounter
      try {
        const res = await fetch('/api/cart')
        if (res.status === 503) { set({ odooUnavailable: true }); return }
        if (!res.ok) return
        const data = await res.json()
        set({ odooUnavailable: false })
        reconcile(data, seq)
      } catch {
        // Transport failure. The cart page relies on this flag to show its "cart unavailable"
        // retry state; without it a network blip renders as a misleading "your cart is empty".
        set({ odooUnavailable: true })
      } finally {
        if (opts?.showLoading) set({ isLoading: false })
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
        existing.packaging_qty += qty
        existing.unit_qty += qty * pkg.qty
        // Recompute price = per-pack price × number of packs. For the unit fallback
        // (pkg.qty === 1) a "pack" is one unit, and the server line reports
        // packaging_qty = 0, so fall back to unit_qty. This replaces the old ratio
        // math that divided by a zero packaging_qty (producing Infinity/NaN totals).
        const packCount = existing.packaging_qty > 0 ? existing.packaging_qty : existing.unit_qty
        existing.price_subtotal = Math.round(pkg.price_per_pack_excl_tax * packCount * 100) / 100
        existing.price_total = Math.round(pkg.price_per_pack_incl_tax * packCount * 100) / 100
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
    addToCartAndSync: async (product, pkg, qty) => {
      get().addLineOptimistic(product, pkg, qty)
      const seq = ++seqCounter
      return holdMutation<{ ok: boolean; message?: string; adjustedPacks?: number }>(async () => {
        try {
          const res = await fetch('/api/cart/lines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // product_id = template_id (the API validates packaging against this template)
            body: JSON.stringify({ product_id: product.template_id, packaging_id: pkg.id, packaging_qty: qty }),
          })
          const data = await res.json().catch(() => null)
          // Resync on failure so the optimistic line is undone.
          if (!res.ok) return { resync: true, result: { ok: false, message: data?.message } }
          applyMutation(data, seq)
          return { resync: false, result: { ok: true, adjustedPacks: data?.adjusted_packs } }
        } catch {
          return { resync: true, result: { ok: false } }
        }
      })
    },
    reorderLines: async (lines) => {
      let failed = 0
      const results = await Promise.allSettled(
        lines.map((l) =>
          fetch('/api/cart/lines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(l),
          }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
          }),
        ),
      )
      for (const r of results) if (r.status === 'rejected') failed++
      await get().fetchCart()
      return { added: lines.length - failed, failed }
    },
    updateLineQty: async (lineId, packagingQty) => {
      // Optimistic lines (negative id) have no server row yet - resync instead of
      // PATCHing a non-existent id (which 404s).
      if (lineId <= 0) { await get().fetchCart(); return { ok: false } }
      const seq = ++seqCounter
      return holdMutation<{ ok: boolean; message?: string; adjustedPacks?: number }>(async () => {
        try {
          const res = await fetch(`/api/cart/lines/${lineId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packaging_qty: packagingQty }),
          })
          const data = await res.json().catch(() => null)
          if (!res.ok) return { resync: true, result: { ok: false, message: data?.message } }
          applyMutation(data, seq)
          return { resync: false, result: { ok: true, adjustedPacks: data?.adjusted_packs } }
        } catch {
          return { resync: true, result: { ok: false } }
        }
      })
    },
    removeLine: async (lineId) => {
      if (lineId <= 0) { await get().fetchCart(); return false }
      const seq = ++seqCounter
      return holdMutation<boolean>(async () => {
        try {
          const res = await fetch(`/api/cart/lines/${lineId}`, { method: 'DELETE' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          applyMutation(await res.json(), seq)
          return { resync: false, result: true }
        } catch {
          return { resync: true, result: false }
        }
      })
    },
  }
})
