#!/usr/bin/env node
// W12: concurrency. "The website needs to withstand traffic" - N customers shopping at once.
//
// STAGING ONLY, same guard as run-writes.mjs.
//
//   ODOO_URL=https://...staging...dev.odoo.com SESSION_SECRET=... \
//     QA_CUSTOMERS="uid:partner,uid:partner,..." N=15 node scripts/qa/run-load.mjs
//
// Why this shape, from two earlier failed attempts:
//   1. The first run used ONE shared login, so all N "customers" wrote to a single cart and
//      fought over the same sale.order row. That measured Postgres row-lock contention, not
//      the portal. Every simulated customer must have their OWN partner.
//   2. The second run fired with no think time from one IP and Odoo rate-limited it, so the
//      numbers measured the rate limiter. Real buyers pause between actions.
//
// It therefore models a SESSION per customer (browse -> view -> add -> cart) with think time,
// and reports the latency distribution per action rather than a single average, because the
// tail is what a customer actually feels.

import crypto from 'node:crypto'

const BASE = process.env.BASE || 'http://localhost:3202'
const SECRET = process.env.SESSION_SECRET
const ODOO_URL = process.env.ODOO_URL || ''
const N = Number(process.env.N || 15)
const THINK_MS = Number(process.env.THINK_MS || 1200)

if (!SECRET) { console.error('SESSION_SECRET is required'); process.exit(2) }
if (!/dev\.odoo\.com/.test(ODOO_URL) || !/staging/i.test(ODOO_URL)) {
  console.error('REFUSING TO RUN. This suite writes carts; staging only.')
  console.error(`  ODOO_URL=${ODOO_URL || '(unset)'}`)
  process.exit(2)
}

const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${crypto.createHmac('sha256', SECRET).update(b).digest('hex')}` }
const cookieFor = (uid, partner) => {
  const now = Math.floor(Date.now() / 1000)
  return 'session=' + sign({ uid, partner_id: partner, commercial_partner_id: partner, odoo_session_id: 'qa', iat: now, exp: now + 3600 })
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const jitter = (ms) => sleep(ms * (0.6 + Math.random() * 0.8))

const samples = []   // {action, ms, status}
async function timed(action, fn) {
  const t0 = Date.now()
  let status = 0
  try { status = await fn() } catch { status = 0 }
  samples.push({ action, ms: Date.now() - t0, status })
  return status
}

const req = async (path, cookie, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  await res.text()
  return res.status
}

// One customer's shopping session, mirroring the real click path.
async function session(cust, idx) {
  const cookie = cookieFor(cust.uid, cust.partner)
  await jitter(idx * 120)                       // stagger arrivals, nobody lands simultaneously

  await timed('browse grid', () => req(`/api/products?page=0&per_page=24&lang=en`, cookie))
  await jitter(THINK_MS)

  const listRes = await fetch(`${BASE}/api/products?page=0&per_page=24&lang=en`, { headers: { cookie } })
  const products = (await listRes.json().catch(() => ({}))).products || []
  const pick = products.filter(p => (p.packaging_options || []).length)[idx % Math.max(1, products.length)] || products[0]

  await timed('search', () => req(`/api/search?q=${encodeURIComponent((pick?.sku || 'a').slice(0, 6))}&lang=en`, cookie))
  await jitter(THINK_MS)

  if (pick) {
    await timed('product detail', () => req(`/api/products/${pick.template_id}?lang=en`, cookie))
    await jitter(THINK_MS)
    const pk = (pick.packaging_options.find(o => o.is_default) || pick.packaging_options[0])
    await timed('add to cart', () => req('/api/cart/lines', cookie, {
      method: 'POST', body: { product_id: pick.template_id, packaging_id: pk.id || null, packaging_qty: 1 },
    }))
    await jitter(THINK_MS)
  }
  await timed('view cart', () => req('/api/cart', cookie))
  return cookie
}

function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

async function main() {
  const raw = process.env.QA_CUSTOMERS
  if (!raw) { console.error('QA_CUSTOMERS="uid:partner,..." is required (each simulated customer needs their OWN partner)'); process.exit(2) }
  const pool = raw.split(',').map(s => { const [uid, partner] = s.split(':').map(Number); return { uid, partner } })
  if (pool.length < N) console.log(`(note) ${pool.length} distinct customers supplied for N=${N}; reusing some, which understates cart contention`)

  const custs = Array.from({ length: N }, (_, i) => pool[i % pool.length])
  console.log(`W12 concurrency: ${N} simultaneous shopping sessions, ~${THINK_MS}ms think time`)
  console.log(`staging=${ODOO_URL}\n`)

  const t0 = Date.now()
  const cookies = await Promise.all(custs.map((c, i) => session(c, i).catch(() => null)))
  const wall = Date.now() - t0

  const byAction = new Map()
  for (const s of samples) {
    if (!byAction.has(s.action)) byAction.set(s.action, [])
    byAction.get(s.action).push(s)
  }
  console.log(`${'action'.padEnd(16)} ${'n'.padEnd(4)} ${'ok'.padEnd(4)} ${'p50'.padEnd(7)} ${'p95'.padEnd(7)} ${'max'.padEnd(7)}`)
  let anyFail = false
  for (const [action, list] of byAction) {
    const ms = list.map(s => s.ms)
    const ok = list.filter(s => s.status >= 200 && s.status < 300).length
    if (ok < list.length) anyFail = true
    console.log(`${action.padEnd(16)} ${String(list.length).padEnd(4)} ${String(ok).padEnd(4)} ${(pct(ms, .5) + 'ms').padEnd(7)} ${(pct(ms, .95) + 'ms').padEnd(7)} ${(Math.max(...ms) + 'ms').padEnd(7)}`)
  }
  const bad = samples.filter(s => !(s.status >= 200 && s.status < 300))
  console.log(`\nwall clock ${(wall / 1000).toFixed(1)}s   requests ${samples.length}   non-2xx ${bad.length}`)
  if (bad.length) {
    const codes = {}
    bad.forEach(s => { codes[`${s.action} ${s.status}`] = (codes[`${s.action} ${s.status}`] || 0) + 1 })
    console.log('non-2xx breakdown:', codes)
  }

  // clean up every cart this run created
  for (const cookie of cookies.filter(Boolean)) {
    try {
      const c = await (await fetch(`${BASE}/api/cart`, { headers: { cookie } })).json()
      for (const l of (c.lines || [])) await fetch(`${BASE}/api/cart/lines/${l.line_id}`, { method: 'DELETE', headers: { cookie } })
    } catch { /* best effort */ }
  }
  console.log('carts cleaned up')
  process.exit(anyFail ? 1 : 0)
}

main().catch(e => { console.error('load suite crashed:', e); process.exit(2) })
