'use client'
import { useState } from 'react'

/**
 * Editable quantity field backed by a numeric prop.
 *
 * The problem this solves: a quantity input bound directly to a number cannot be
 * cleared. Both quantity fields in the portal did this —
 *
 *     const v = parseInt(e.target.value)
 *     if (isNaN(v) || v < min) return          // QuantitySelector
 *     const v = Math.max(1, parseInt(e.target.value) || 1)   // quick-order
 *
 * — and both fail the same way. Backspacing the last digit makes `e.target.value`
 * the empty string, which parses to NaN, so the handler either bails or coerces
 * back to 1. Either way React immediately re-renders the OLD number and the digit
 * reappears. The field can never be emptied, so a customer cannot select-and-retype
 * a quantity; they are stuck with the +/- buttons. It is worst on a phone, where
 * "tap the field, backspace, type the number" is the natural gesture, but it
 * behaves identically on desktop.
 *
 * The fix is to let the field hold a transient string that is not yet a valid
 * quantity — "" while the customer is mid-edit — and only push a number upward
 * once one can be parsed. `draft === null` means "not being edited, show the prop".
 *
 * On blur the field is normalised: an empty or below-min value falls back to `min`
 * rather than leaving the customer looking at a blank box.
 *
 * `onFocus` selects the whole value so tapping the field highlights the number and the
 * next keystroke replaces it, instead of dropping a caret behind the digit and forcing a
 * backspace first. This is why the field must be `type="text"` + `inputMode="numeric"` and
 * NOT `type="number"`: a number input does not support the text-selection API at all
 * (`selectionStart` reads back `null` and `select()` does nothing), so the caret always
 * landed behind the number and it could not be highlighted. `inputMode` keeps the numeric
 * keypad on phones, and switching away from `type="number"` also drops the desktop spinner
 * arrows and the scroll-wheel-changes-the-value hazard. Validation was never relying on the
 * number type — the regex below does it.
 *
 * Deliberately NO upper-bound clamp while typing. An earlier version rejected any
 * keystroke that pushed the value past `max`, which fought the customer mid-type
 * (silently ignoring digits, or snapping back to the cap) and read as a broken
 * input. `max` guides the +/- buttons; real enforcement is server-side on Add,
 * which is where it belongs.
 */
export function useQuantityInput(value: number, min: number, commit: (n: number) => void) {
  const [draft, setDraft] = useState<string | null>(null)

  return {
    /** Value to render. Falls back to the prop whenever the field is not mid-edit. */
    value: draft ?? String(value),

    onChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value

      // Empty is a legitimate intermediate state: it is what "clear the field
      // before typing a new number" looks like. Hold it and commit nothing yet.
      if (raw === '') {
        setDraft('')
        return
      }

      // type="number" already hands us '' for junk like "abc"; this also drops
      // the "e", "+" and "-" that a number input otherwise permits.
      if (!/^\d+$/.test(raw)) return

      const n = parseInt(raw, 10)
      if (Number.isNaN(n)) return

      setDraft(raw)
      // Only push valid quantities up. Typing "0" toward "10" holds locally
      // without committing a zero to the cart.
      if (n >= min) commit(n)
    },

    onFocus(e: React.FocusEvent<HTMLInputElement>) {
      // Capture the node synchronously; the timeout is for iOS Safari, which ignores
      // select() called during the focus event itself.
      const el = e.currentTarget
      setTimeout(() => { try { el.select() } catch { /* detached */ } }, 0)
    },

    onBlur() {
      const n = draft === null ? value : parseInt(draft, 10)
      if (draft === '' || Number.isNaN(n) || n < min) commit(min)
      setDraft(null) // hand control back to the prop
    },

    /** Call after +/- so the buttons win over a stale draft. */
    clearDraft() {
      setDraft(null)
    },
  }
}
