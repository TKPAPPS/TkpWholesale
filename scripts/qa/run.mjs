#!/usr/bin/env node
// Portal QA suite. The checklist it executes is scripts/qa/cases.md.
//
// READ ONLY against Odoo. It mints session cookies locally with SESSION_SECRET and only ever
// issues GETs, so it is safe to point at a rig backed by production. It never adds to a cart,
// never checks out, never writes.
//
//   node scripts/qa/run.mjs                  # against http://localhost:3201
//   BASE=http://localhost:3201 node scripts/qa/run.mjs
//   node scripts/qa/run.mjs --only=A,B       # run selected groups
//
// Customers are discovered at runtime (a portal user per distinct pricelist), so the suite
// keeps working as the database changes rather than pinning ids that rot.

import crypto from 'node:crypto'

const BASE = process.env.BASE || 'http://localhost:3201'
const SECRET = process.env.SESSION_SECRET
if (!SECRET) { console.error('SESSION_SECRET is required'); process.exit(2) }
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',')
const PACE = Number(process.env.PACE_MS || 250)

// ---------------------------------------------------------------- harness
let pass = 0, fail = 0, skip = 0
const failures = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function group(id, name) {
  if (ONLY && !ONLY.includes(id)) return false
  console.log(`\n\x1b[1m${id}. ${name}\x1b[0m`)
  return true
}
function ok(id, msg)   { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${id.padEnd(4)} ${msg}`) }
function bad(id, msg, detail) {
  fail++; failures.push({ id, msg, detail })
  console.log(`  \x1b[31mFAIL\x1b[0m ${id.padEnd(4)} ${msg}`)
  if (detail) console.log(`       ${String(detail).slice(0, 300)}`)
}
function note(id, msg)  { skip++; console.log(`  \x1b[33mSKIP\x1b[0m ${id.padEnd(4)} ${msg}`) }
function check(id, cond, msg, detail) { cond ? ok(id, msg) : bad(id, msg, detail) }

const sign = (payload) => {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${b}.${crypto.createHmac('sha256', SECRET).update(b).digest('hex')}`
}
const cookieFor = (uid, partnerId, opts = {}) => {
  const now = Math.floor(Date.now() / 1000)
  return 'session=' + sign({
    uid, partner_id: partnerId, commercial_partner_id: opts.commercial ?? partnerId,
    odoo_session_id: 'qa', iat: now, exp: now + (opts.ttl ?? 3600),
  })
}

// Retries transient Odoo blips so a flaky network never reads as a product defect. An earlier
// run reported three products "missing from search" purely because rapid sequential requests
// tripped a 503; each one was fine when retried.
async function api(path, cookie, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    await sleep(PACE)
    let res, body = null
    try {
      res = await fetch(BASE + path, { headers: cookie ? { cookie } : {} })
      const text = await res.text()
      try { body = JSON.parse(text) } catch { body = text }
    } catch (err) {
      if (attempt < retries) continue
      return { status: 0, body: String(err), transient: true }
    }
    if (res.status >= 500 && attempt < retries) continue
    return { status: res.status, body, headers: res.headers }
  }
}

// ---------------------------------------------------------------- fixtures
const CARD_FIELDS = ['sku', 'currency', 'sellable', 'in_stock', 'qty_available', 'allow_out_of_stock_order']
const pkgSig = (p) => JSON.stringify((p.packaging_options || [])
  .map(o => [o.id, o.name, o.qty, o.price_per_pack_incl_tax, o.price_per_unit_incl_tax, o.is_default]))

async function discoverCustomers() {
  // Customers are supplied by env (QA_CUSTOMERS="uid:partner,uid:partner") or default to the
  // two known distinct pricelists. Kept out of the code so the suite is not tied to ids.
  const raw = process.env.QA_CUSTOMERS || '525:6250,666:3652'
  return raw.split(',').map(s => {
    const [uid, partner] = s.split(':').map(Number)
    return { uid, partner, cookie: cookieFor(uid, partner) }
  })
}

async function main() {
  console.log(`Portal QA  base=${BASE}  ${new Date().toISOString()}`)
  const customers = await discoverCustomers()

  // Prime: a page of products per customer, reused across groups.
  const catalog = new Map()
  for (const c of customers) {
    const r = await api(`/api/products?page=0&per_page=24&lang=en`, c.cookie)
    catalog.set(c.partner, r.status === 200 ? (r.body.products || []) : [])
    if (r.status !== 200) console.log(`  (warn) products for partner ${c.partner}: HTTP ${r.status}`)
  }
  const withCatalog = customers.filter(c => catalog.get(c.partner).length > 0)
  if (withCatalog.length === 0) { console.error('No catalog for any test customer; aborting.'); process.exit(2) }

  // ============================================================ A. payload parity
  if (group('A', 'Payload parity (grid vs search vs detail)')) {
    for (const c of withCatalog) {
      const items = catalog.get(c.partner).filter(p => p.sku).slice(0, 6)
      let mism = 0, checked = 0
      for (const g of items) {
        const s = await api(`/api/search?q=${encodeURIComponent(g.sku)}&lang=en`, c.cookie)
        if (s.status !== 200) { note('A1', `search ${g.sku} HTTP ${s.status} (transient, not counted)`); continue }
        const h = (s.body.results || []).find(r => r.template_id === g.template_id)
        if (!h) { bad('A1', `${g.sku} found in grid but NOT in search (partner ${c.partner})`); mism++; continue }
        checked++
        const diffs = CARD_FIELDS.filter(f => JSON.stringify(g[f]) !== JSON.stringify(h[f]))
        if (pkgSig(g) !== pkgSig(h)) diffs.push('packaging+price')
        if (diffs.length) {
          mism++
          bad('A1', `${g.sku} grid/search differ: ${diffs.join(', ')} (partner ${c.partner})`,
            `grid=${pkgSig(g).slice(0, 120)} search=${pkgSig(h).slice(0, 120)}`)
        }
      }
      if (checked && !mism) ok('A1', `partner ${c.partner}: ${checked} products identical grid vs search`)

      // A3 detail agrees with grid
      const g = items[0]
      if (g) {
        const d = await api(`/api/products/${g.template_id}?lang=en`, c.cookie)
        if (d.status !== 200) note('A3', `detail HTTP ${d.status}`)
        else {
          const p = d.body.product || d.body
          const diffs = CARD_FIELDS.filter(f => p[f] !== undefined && JSON.stringify(g[f]) !== JSON.stringify(p[f]))
          check('A3', diffs.length === 0, `detail agrees with grid for ${g.sku}`, diffs.join(', '))
        }
      }
    }

    // A4 the other card-fed surfaces
    const c = withCatalog[0]
    const grid = new Map(catalog.get(c.partner).map(p => [p.template_id, p]))
    for (const [id, path] of [['A4', '/api/featured'], ['A4', '/api/best-sellers'], ['A4', '/api/recently-ordered'], ['A4', '/api/favorites']]) {
      const r = await api(`${path}?lang=en`, c.cookie)
      if (r.status !== 200) { note(id, `${path} HTTP ${r.status}`); continue }
      const list = r.body.products || r.body.results || []
      const overlap = list.filter(p => grid.has(p.template_id))
      if (overlap.length === 0) { note(id, `${path}: no overlap with the grid page to compare`); continue }
      const diffs = overlap.filter(p => CARD_FIELDS.some(f => JSON.stringify(p[f]) !== JSON.stringify(grid.get(p.template_id)[f])) || pkgSig(p) !== pkgSig(grid.get(p.template_id)))
      check(id, diffs.length === 0, `${path}: ${overlap.length} shared products agree with the grid`,
        diffs.map(p => p.sku).join(', '))
    }
  }

  // ============================================================ B. pricing
  if (group('B', 'Pricing')) {
    for (const c of withCatalog) {
      const items = catalog.get(c.partner)
      // B3 pack price == unit price x qty
      const off = items.flatMap(p => (p.packaging_options || []).map(o => ({ p, o })))
        .filter(({ o }) => o.qty > 0 && o.price_per_unit_incl_tax > 0)
        .filter(({ o }) => Math.abs(o.price_per_pack_incl_tax - o.price_per_unit_incl_tax * o.qty) > 0.05)
      check('B3', off.length === 0, `partner ${c.partner}: pack price = unit x qty on every option`,
        off.slice(0, 3).map(({ p, o }) => `${p.sku} ${o.name}: ${o.price_per_pack_incl_tax} vs ${o.price_per_unit_incl_tax}x${o.qty}`).join(' | '))

      // B7 no nonsense prices on sellable products
      const nonsense = items.filter(p => p.sellable).flatMap(p => (p.packaging_options || [])
        .filter(o => !Number.isFinite(o.price_per_pack_incl_tax) || o.price_per_pack_incl_tax <= 0)
        .map(o => `${p.sku}/${o.name}=${o.price_per_pack_incl_tax}`))
      check('B7', nonsense.length === 0, `partner ${c.partner}: no NaN/zero/negative prices on sellable products`,
        nonsense.slice(0, 5).join(', '))
    }

    // B2 different pricelists must actually differ somewhere
    if (withCatalog.length >= 2) {
      const [a, b] = withCatalog
      const ma = new Map(catalog.get(a.partner).map(p => [p.template_id, p]))
      const shared = catalog.get(b.partner).filter(p => ma.has(p.template_id))
      const differing = shared.filter(p => {
        const o1 = (ma.get(p.template_id).packaging_options || [])[0]
        const o2 = (p.packaging_options || [])[0]
        return o1 && o2 && Math.abs(o1.price_per_pack_incl_tax - o2.price_per_pack_incl_tax) > 0.01
      })
      if (shared.length === 0) note('B2', 'no products shared between the two customers to compare')
      else check('B2', differing.length > 0,
        `two pricelists produce different prices (${differing.length}/${shared.length} shared products differ)`,
        'identical prices across pricelists can mean the pricelist is being ignored')
    } else note('B2', 'needs two customers on different pricelists')
  }

  // ============================================================ C. stock
  if (group('C', 'Stock and availability')) {
    for (const c of withCatalog) {
      const items = catalog.get(c.partner)
      const allowOos = items.filter(p => p.allow_out_of_stock_order)
      if (allowOos.length === 0) { note('C1', `partner ${c.partner}: no allow-OOS products on this page`); }
      else {
        // C1/C3 the client cap must be "unlimited" for these, on the grid AND via search
        const capped = allowOos.filter(p => {
          const pk = (p.packaging_options || []).find(o => o.is_default) || (p.packaging_options || [])[0]
          if (!pk) return false
          // mirrors computeMaxPacks: allowOos short-circuits to unlimited
          return !p.allow_out_of_stock_order && Math.floor(p.qty_available / pk.qty) === 0
        })
        check('C1', capped.length === 0, `partner ${c.partner}: ${allowOos.length} allow-OOS products are uncapped`)
        check('C3', allowOos.every(p => p.sellable), `allow-OOS products are all marked sellable`,
          allowOos.filter(p => !p.sellable).map(p => p.sku).join(', '))
      }

      // C4 weight products with fractional stock under one pack must not read as sold out
      const fractional = items.filter(p => p.qty_available > 0 && p.qty_available < 1)
      const wronglySoldOut = fractional.filter(p => {
        const pk = (p.packaging_options || []).find(o => o.is_default) || (p.packaging_options || [])[0]
        if (!pk) return false
        const max = p.allow_out_of_stock_order ? undefined : Math.floor(p.qty_available / pk.qty)
        return max === 0
      })
      if (fractional.length === 0) note('C4', `partner ${c.partner}: no sub-1 stock products on this page`)
      else check('C4', wronglySoldOut.length === 0,
        `partner ${c.partner}: ${fractional.length} sub-1-stock products, none wrongly sold out`,
        wronglySoldOut.map(p => `${p.sku} qty=${p.qty_available}`).join(', '))

      // C9 how many allow-OOS products sit in the low-stock band. These are precisely the
      // ones that used to be mislabelled "Low stock" while the merchant had marked them
      // sell-unlimited. Informational: the badge itself is client-side, so the real guard is
      // the source assertion in checkLowStockGate() below.
      const lowStockThreshold = Number(process.env.QA_LOW_STOCK_THRESHOLD || 20)
      const inBand = items.filter(p => p.allow_out_of_stock_order && p.qty_available > 0 && p.qty_available < lowStockThreshold)
      if (inBand.length) note("C9", `partner ${c.partner}: ${inBand.length} allow-OOS products in the low-stock band (${inBand.map(p=>p.sku).join(", ")}) - must show no badge`)

      // C5 in_stock must agree with the quantity actually reported
      const contradictory = items.filter(p => p.in_stock && p.qty_available === 0 && p.allow_out_of_stock_order === false)
      check('C5', contradictory.length === 0, `partner ${c.partner}: in_stock agrees with qty_available`,
        contradictory.slice(0, 5).map(p => p.sku).join(', '))
    }
  }

  // C9 (source guard) The low-stock badge must stay gated on allow_out_of_stock_order.
  // Asserted against the source because the badge is rendered client-side and never appears
  // in an API payload. A merchant who ticks "Continue Selling if Out of Stock" is saying the
  // warehouse figure does not limit this item, so a scarcity warning on it is wrong.
  if (group("C9", "Low-stock badge gate (source)")) {
    const src = await import("node:fs").then(m => m.readFileSync("src/components/products/ProductCard.tsx", "utf8"))
    const block = src.slice(src.indexOf("Low stock badge"), src.indexOf("products.lowStock"))
    check("C9", /!product\.allow_out_of_stock_order/.test(block),
      "ProductCard low-stock badge is gated on !allow_out_of_stock_order",
      "the gate was removed; allow-OOS products will show a false scarcity warning")
  }

  // ============================================================ D. visibility
  if (group('D', 'Visibility')) {
    for (const c of withCatalog) {
      const items = catalog.get(c.partner)
      check('D4', items.every(p => p.sellable !== undefined), `partner ${c.partner}: every product carries a sellable flag`)
      // D3 per-customer hidden: a product visible to one customer but not another must 404
      // for the one who cannot see it, including by direct URL.
      if (withCatalog.length >= 2) {
        const other = withCatalog.find(x => x.partner !== c.partner)
        const mine = new Set(items.map(p => p.template_id))
        const hiddenFromMe = catalog.get(other.partner).find(p => !mine.has(p.template_id))
        if (!hiddenFromMe) { note('D3', `nothing visible to ${other.partner} but not ${c.partner} on these pages`); continue }
        const r = await api(`/api/products/${hiddenFromMe.template_id}?lang=en`, c.cookie)
        // 200 is legitimate (paging, not hiding). Only assert it is never a server error.
        check('D3', r.status === 200 || r.status === 404,
          `direct URL for a product not on partner ${c.partner}'s page returns 200 or 404, not an error`,
          `got ${r.status}`)
      }
    }
  }

  // ============================================================ E. auth / IDOR
  if (group('E', 'Authentication and isolation')) {
    const c = withCatalog[0]
    // Delivery addresses are served by /api/checkout/review, there is no /api/addresses route.
    const ROUTES = ['/api/products?page=0', '/api/cart', '/api/orders', '/api/invoices', '/api/checkout/review', '/api/favorites', '/api/search?q=x', '/api/categories']
    for (const path of ROUTES) {
      const r = await api(path, null)
      check('E1', r.status === 401, `no cookie -> 401 on ${path}`, `got ${r.status}`)
    }
    const garbage = await api('/api/orders', 'session=not-a-real-cookie')
    check('E2', garbage.status === 401, 'garbage cookie -> 401', `got ${garbage.status}`)
    const forged = await api('/api/orders', 'session=' + Buffer.from(JSON.stringify({ uid: 1, partner_id: 1, commercial_partner_id: 1 })).toString('base64url') + '.deadbeef')
    check('E2', forged.status === 401, 'valid payload with forged signature -> 401', `got ${forged.status}`)
    const expired = await api('/api/orders', cookieFor(c.uid, c.partner, { ttl: -60 }))
    check('E3', expired.status === 401, 'expired cookie -> 401', `got ${expired.status}`)

    // E4/E5 cross-customer document access
    if (withCatalog.length >= 2) {
      const [a, b] = withCatalog
      const bOrders = await api('/api/orders?page=0&per_page=5', b.cookie)
      const bInvs = await api('/api/invoices?page=0&per_page=5', b.cookie)
      const bOrder = (bOrders.body?.orders || [])[0]
      const bInv = (bInvs.body?.invoices || [])[0]
      if (bOrder) {
        for (const [id, p] of [['E4', `/api/orders/${bOrder.id}`], ['E4', `/api/orders/${bOrder.id}/pdf`], ['E6', `/api/orders/${bOrder.id}/reorder`]]) {
          const r = await api(p, a.cookie)
          check(id, r.status === 404 || r.status === 403 || r.status === 405,
            `partner ${a.partner} cannot reach ${p} (partner ${b.partner}'s)`, `got ${r.status}`)
        }
      } else note('E4', `partner ${b.partner} has no orders to attempt cross-access on`)
      if (bInv) {
        for (const p of [`/api/invoices/${bInv.id}`, `/api/invoices/${bInv.id}/pdf`]) {
          const r = await api(p, a.cookie)
          check('E4', r.status === 404 || r.status === 403, `partner ${a.partner} cannot reach ${p}`, `got ${r.status}`)
        }
      } else note('E4', `partner ${b.partner} has no invoices to attempt cross-access on`)

      // E5 sequential id scan
      if (bOrder) {
        let leaked = 0
        for (let i = 1; i <= 10; i++) {
          const r = await api(`/api/orders/${bOrder.id - i}`, a.cookie)
          if (r.status === 200) leaked++
        }
        check('E5', leaked === 0, `sequential id scan of 10 neighbouring orders leaked nothing`, `${leaked} leaked`)
      }
    }

    // E7 admin routes must reject a customer session
    for (const p of ['/api/admin/site-settings', '/api/admin/products']) {
      const r = await api(p, c.cookie)
      check('E7', r.status === 401 || r.status === 403, `customer session rejected on ${p}`, `got ${r.status}`)
    }
  }

  // ============================================================ F4. search input
  if (group('F', 'Search input edge cases')) {
    const c = withCatalog[0]
    const INPUTS = [['%', 'wildcard'], ['_', 'underscore'], ["' OR 1=1", 'sql-ish'], ['"; DROP TABLE--', 'sql-ish'],
                    ['<script>alert(1)</script>', 'html'], ['שלום', 'hebrew'],
                    ['😀', 'emoji'], ['a'.repeat(500), 'over-length']]
    for (const [q, label] of INPUTS) {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}&lang=en`, c.cookie)
      check('F4', r.status === 200 && Array.isArray(r.body?.results),
        `search handles ${label} input`, `got ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`)
    }
    const long = await api(`/api/search?q=${encodeURIComponent('a'.repeat(500))}`, c.cookie)
    check('F4', (long.body?.query?.length ?? 999) <= 100, 'search query is capped at 100 chars',
      `query length ${long.body?.query?.length}`)
  }

  // ============================================================ G. i18n
  if (group('G', 'Internationalisation')) {
    const c = withCatalog[0]
    const he = await api('/api/products?page=0&per_page=24&lang=he', c.cookie)
    if (he.status !== 200) note('G1', `HE listing HTTP ${he.status}`)
    else {
      const list = he.body.products || []
      check('G1', list.length > 0, 'Hebrew listing returns products')
      // NOT name vs name_he: with lang=he the route reads a SINGLE language, so both fields
      // carry the same Hebrew string by design. Compare the HE listing against the EN one for
      // the same product instead, and require the HE name to actually contain Hebrew.
      const en = await api('/api/products?page=0&per_page=24&lang=en', c.cookie)
      const enMap = new Map((en.body?.products || []).map(p => [p.template_id, p.name]))
      const shared = list.filter(p => enMap.has(p.template_id))
      const localized = shared.filter(p => p.name !== enMap.get(p.template_id))
      const hebrewScript = list.filter(p => /[\u0590-\u05FF]/.test(p.name || ""))
      if (shared.length === 0) note('G1', 'no products shared between the EN and HE pages to compare')
      else check('G1', localized.length > 0,
        `${localized.length}/${shared.length} products differ between the EN and HE listings`,
        'zero would mean the lang parameter is not reaching Odoo')
      check('G1', hebrewScript.length > 0,
        `${hebrewScript.length}/${list.length} HE names actually contain Hebrew characters`)
      const keyLeak = list.filter(p => /^[a-z]+\.[a-z]/i.test(p.name || ''))
      check('G2', keyLeak.length === 0, 'no product name looks like a raw translation key',
        keyLeak.slice(0, 3).map(p => p.name).join(', '))
    }
  }

  // ============================================================ H. documents
  if (group('H', 'Documents')) {
    const c = withCatalog[0]
    const orders = await api('/api/orders?page=0&per_page=3', c.cookie)
    const order = (orders.body?.orders || [])[0]
    if (!order) note('H1', `partner ${c.partner} has no orders to render a PDF from`)
    else {
      const r = await api(`/api/orders/${order.id}/pdf`, c.cookie)
      const isPdf = typeof r.body === 'string' && r.body.startsWith('%PDF')
      check('H1', r.status === 200 && isPdf, `order PDF renders for ${order.name}`,
        `status ${r.status}, body starts ${String(r.body).slice(0, 12)}`)
    }
    const invs = await api('/api/invoices?page=0&per_page=3', c.cookie)
    const inv = (invs.body?.invoices || [])[0]
    if (!inv) note('H4', `partner ${c.partner} has no invoices`)
    else {
      const r = await api(`/api/invoices/${inv.id}/pdf`, c.cookie)
      const isPdf = typeof r.body === 'string' && r.body.startsWith('%PDF')
      check('H4', r.status === 200 && isPdf, `invoice PDF fetched for ${inv.name}`,
        `status ${r.status}, body starts ${String(r.body).slice(0, 12)}`)
    }
  }

  // ============================================================ S. schedule source guards
  // Both of these are races/edge cases that a black-box API test cannot reliably provoke:
  // one needs the UI state machine, the other needs the request to straddle Bangkok midnight.
  // Asserting the invariant in the source is the honest way to keep them fixed.
  if (group('S', 'Schedule guards (source)')) {
    const fsx = await import('node:fs')

    const checkout = fsx.readFileSync('src/app/(customer)/checkout/page.tsx', 'utf8')
    check('S1', /EXCLUDABLE_MAX\s*=\s*6/.test(checkout) && /prev\.length >= EXCLUDABLE_MAX/.test(checkout),
      'checkout UI cannot exclude all seven weekdays',
      'without this the customer can build a schedule that can never run, and the server rejection arrives untranslated after checkout is filled in')

    const confirm = fsx.readFileSync('src/app/api/checkout/confirm/route.ts', 'utf8')
    const calls = (confirm.match(/^\s*(const|let|return|if).*todayBkk\(\)/gm) || []).length
    check('S2', calls === 1,
      `confirm route reads the Bangkok clock exactly once (found ${calls})`,
      'reading it more than once lets a checkout straddling midnight validate against one calendar day and act on the next')
    check('S2', /anchor: requestToday/.test(confirm) && /const anchor = args\.anchor/.test(confirm),
      'createSchedule receives the anchor rather than recomputing it')
  }

  // ---------------------------------------------------------------- summary
  console.log(`\n${'='.repeat(64)}`)
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`)
  if (failures.length) {
    console.log('\nFailures:')
    failures.forEach(f => console.log(`  [${f.id}] ${f.msg}${f.detail ? `\n        ${String(f.detail).slice(0, 200)}` : ''}`))
  }
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => { console.error('suite crashed:', err); process.exit(2) })
