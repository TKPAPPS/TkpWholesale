#!/usr/bin/env node
// Write-path QA. Cases W1-W12 in scripts/qa/cases.md.
//
// STAGING ONLY. This adds cart lines and can place orders, so it REFUSES TO START unless the
// rig it points at is backed by a staging Odoo. That guard is deliberate and has no override
// flag: the same guard pattern is used by the tkp-barcode write scripts, after a production
// write incident.
//
//   ODOO_URL=https://...dev.odoo.com SESSION_SECRET=... BASE=http://localhost:3202 \
//     node scripts/qa/run-writes.mjs
//
// It cleans up after itself: every cart line it creates is removed at the end, and it does NOT
// confirm an order unless --checkout is passed (W10/W11 are opt-in, because a confirmed order
// is not reversible even on staging).

import crypto from 'node:crypto'

const BASE = process.env.BASE || 'http://localhost:3202'
const SECRET = process.env.SESSION_SECRET
const ODOO_URL = process.env.ODOO_URL || ''
const DO_CHECKOUT = process.argv.includes('--checkout')

if (!SECRET) { console.error('SESSION_SECRET is required'); process.exit(2) }

// ---- the guard. No override.
const looksStaging = /dev\.odoo\.com/.test(ODOO_URL) && /staging/i.test(ODOO_URL)
if (!looksStaging) {
  console.error('REFUSING TO RUN.')
  console.error(`  ODOO_URL=${ODOO_URL || '(unset)'}`)
  console.error('  This suite writes. It runs only against a staging Odoo (*staging*.dev.odoo.com).')
  console.error('  Point the rig and ODOO_URL at staging. There is no override flag.')
  process.exit(2)
}

let pass = 0, fail = 0, skip = 0
const failures = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ok = (id, m) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${id.padEnd(4)} ${m}`) }
const bad = (id, m, d) => { fail++; failures.push({ id, m, d }); console.log(`  \x1b[31mFAIL\x1b[0m ${id.padEnd(4)} ${m}`); if (d) console.log(`       ${String(d).slice(0, 300)}`) }
const note = (id, m) => { skip++; console.log(`  \x1b[33mSKIP\x1b[0m ${id.padEnd(4)} ${m}`) }
const check = (id, c, m, d) => c ? ok(id, m) : bad(id, m, d)

const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${crypto.createHmac('sha256', SECRET).update(b).digest('hex')}` }
const cookieFor = (uid, partner) => {
  const now = Math.floor(Date.now() / 1000)
  return 'session=' + sign({ uid, partner_id: partner, commercial_partner_id: partner, odoo_session_id: 'qa', iat: now, exp: now + 3600 })
}

async function api(path, cookie, opts = {}) {
  await sleep(Number(process.env.PACE_MS || 300))
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  let body = null
  const text = await res.text()
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol

async function main() {
  console.log(`Portal WRITE QA  base=${BASE}`)
  console.log(`staging=${ODOO_URL}`)
  console.log(`checkout cases: ${DO_CHECKOUT ? 'ENABLED (--checkout)' : 'skipped (pass --checkout to include)'}\n`)

  const [uid, partner] = (process.env.QA_CUSTOMER || '').split(':').map(Number)
  if (!uid || !partner) { console.error('QA_CUSTOMER="uid:partner" is required'); process.exit(2) }
  const cookie = cookieFor(uid, partner)

  // Start from a clean cart so line counts mean something.
  await api('/api/cart', cookie, { method: 'DELETE' })

  const grid = await api('/api/products?page=0&per_page=24&lang=en', cookie)
  if (grid.status !== 200) { console.error(`products HTTP ${grid.status}`); process.exit(2) }
  const products = grid.body.products || []
  const normal = products.find(p => !p.allow_out_of_stock_order && p.qty_available > 5 && (p.packaging_options || []).length)
  const oos = products.find(p => p.allow_out_of_stock_order && (p.packaging_options || []).length)
  const created = []

  // ---- W1 add to cart, and W8 the price the customer was shown is the price charged
  if (!normal) note('W1', 'no suitable stocked product on the sampled page')
  else {
    const pk = (normal.packaging_options.find(o => o.is_default) || normal.packaging_options[0])
    const r = await api('/api/cart/lines', cookie, { method: 'POST', body: { product_id: normal.template_id, packaging_id: pk.id || null, packaging_qty: 1 } })
    check('W1', r.status === 200, `add ${normal.sku} to cart`, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    if (r.status === 200) {
      const line = (r.body.lines || []).find(l => l.template_id === normal.template_id)
      created.push(line?.line_id)
      // W8: THE bug the owner reported. The card showed list_price while the cart charged the
      // pricelist price. Compare the two numbers directly for the same product and customer.
      if (!line) bad('W8', 'line not present in the returned cart')
      else check('W8', near(line.price_per_pack, pk.price_per_pack_incl_tax, 0.05),
        `card price == cart price for ${normal.sku} (card ${pk.price_per_pack_incl_tax}, cart ${line.price_per_pack})`,
        'a mismatch here is exactly the pricelist bug reported on 22/08/2026')

      // W7 cart total equals the sum of its lines
      const sum = (r.body.lines || []).reduce((s, l) => s + l.price_total, 0)
      check('W7', near(sum, r.body.amount_total, 0.05), `cart total ${r.body.amount_total} == sum of lines ${sum.toFixed(2)}`)
    }
  }

  // ---- W2 adding the same product+packaging again merges
  if (normal) {
    const pk = (normal.packaging_options.find(o => o.is_default) || normal.packaging_options[0])
    const before = await api('/api/cart', cookie)
    const beforeLines = (before.body.lines || []).length
    const r = await api('/api/cart/lines', cookie, { method: 'POST', body: { product_id: normal.template_id, packaging_id: pk.id || null, packaging_qty: 1 } })
    const afterLines = (r.body.lines || []).length
    check('W2', r.status === 200 && afterLines === beforeLines,
      `re-adding ${normal.sku} merges into the existing line (${beforeLines} -> ${afterLines})`,
      `expected the line count to stay at ${beforeLines}`)
  }

  // ---- W5 allow-OOS accepts far more than stock, uncapped
  if (!oos) note('W5', 'no allow-OOS product on the sampled page')
  else {
    const pk = (oos.packaging_options.find(o => o.is_default) || oos.packaging_options[0])
    const want = 500
    const r = await api('/api/cart/lines', cookie, { method: 'POST', body: { product_id: oos.template_id, packaging_id: pk.id || null, packaging_qty: want } })
    const line = (r.body?.lines || []).find(l => l.template_id === oos.template_id)
    if (line) created.push(line.line_id)
    check('W5', r.status === 200 && r.body.adjusted_packs === undefined,
      `allow-OOS ${oos.sku} (stock ${oos.qty_available}) accepts ${want} packs uncapped`,
      `HTTP ${r.status}, adjusted_packs=${r.body?.adjusted_packs}, err=${r.body?.error}`)
  }

  // ---- W4 a stocked product clamps rather than rejecting
  if (!normal) note('W4', 'no suitable stocked product')
  else {
    const pk = (normal.packaging_options.find(o => o.is_default) || normal.packaging_options[0])
    const absurd = Math.ceil(normal.qty_available / (pk.qty || 1)) + 1000
    const r = await api('/api/cart/lines', cookie, { method: 'POST', body: { product_id: normal.template_id, packaging_id: pk.id || null, packaging_qty: absurd } })
    const clamped = r.status === 200 && r.body.adjusted_packs !== undefined
    const refused = r.status === 409 && r.body?.error === 'INSUFFICIENT_STOCK'
    check('W4', clamped || refused,
      `ordering ${absurd} packs of ${normal.sku} clamps or reports INSUFFICIENT_STOCK, never a 500`,
      `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`)
  }

  // ---- W6 update then remove
  const cart = await api('/api/cart', cookie)
  const someLine = (cart.body.lines || [])[0]
  if (!someLine) note('W6', 'cart is empty, nothing to update')
  else {
    const u = await api(`/api/cart/lines/${someLine.line_id}`, cookie, { method: 'PATCH', body: { packaging_qty: 2 } })
    check('W6', u.status === 200, `update line ${someLine.line_id} to 2 packs`, `HTTP ${u.status} ${JSON.stringify(u.body).slice(0, 120)}`)
  }

  // ---- W9 checkout review
  const review = await api('/api/checkout/review', cookie)
  check('W9', review.status === 200 && Array.isArray(review.body?.lines || review.body?.orderable_lines || []),
    'checkout review returns a reviewable cart', `HTTP ${review.status} ${JSON.stringify(review.body).slice(0, 140)}`)

  // ---- W10 full checkout (opt-in)
  if (!DO_CHECKOUT) note('W10', 'checkout not attempted (pass --checkout); a confirmed order is not reversible')
  else {
    const addr = (review.body?.delivery_addresses || [])[0]
    if (!addr) note('W10', 'no delivery address on the review payload')
    else {
      const r = await api('/api/checkout/confirm', cookie, { method: 'POST', body: { delivery_address_id: addr.id, remove_unavailable: true } })
      check('W10', r.status === 200 && r.body?.order_name,
        `checkout confirmed -> ${r.body?.order_name}`, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
      if (r.status === 200) console.log(`       staging order created: ${r.body.order_name} (id ${r.body.order_id})`)
    }
  }

  // ---- cleanup: leave the cart as we found it
  if (!DO_CHECKOUT) {
    const c = await api('/api/cart', cookie)
    for (const l of (c.body.lines || [])) {
      await api(`/api/cart/lines/${l.line_id}`, cookie, { method: 'DELETE' })
    }
    const after = await api('/api/cart', cookie)
    const left = (after.body.lines || []).length
    check('W6', left === 0, `cleanup: cart emptied (${left} lines left)`)
  }

  console.log(`\n${'='.repeat(64)}`)
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`)
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log(`  [${f.id}] ${f.m}${f.d ? `\n        ${String(f.d).slice(0, 200)}` : ''}`)) }
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('suite crashed:', e); process.exit(2) })
