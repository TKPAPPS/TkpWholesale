// Capture live, authenticated, un-cropped screenshots of the B2B portal in Hebrew.
// Drives the already-installed system Chrome via puppeteer-core (no Chromium download).
//
// Env:
//   BASE_URL   default http://localhost:3000
//   LOGIN      customer email          (required)
//   PASSWORD   customer password       (required)
//   CHROME     path to Chrome binary   (default: macOS Google Chrome)
//
// Output: assets/shots/*.png  (viewport 1920x1080 @2x => 3840x2160 PNGs)

import puppeteer from 'puppeteer-core'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'assets/shots')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const LOGIN = process.env.LOGIN
const PASSWORD = process.env.PASSWORD
const CHROME =
  process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!LOGIN || !PASSWORD) {
  console.error('Missing LOGIN / PASSWORD env vars.')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
  })

  const page = await browser.newPage()

  // Force Hebrew UI (RTL): set the `lang` cookie via the page origin so SSR
  // (layout.tsx reads cookies().get('lang')) renders RTL + Hebrew on every route.
  const forceHebrew = async () => {
    await page.evaluate(() => {
      document.cookie = 'lang=he; path=/; max-age=31536000; SameSite=Lax'
    })
  }

  const shoot = async (name, { full = false } = {}) => {
    await sleep(700) // settle fonts/images
    await page.screenshot({ path: resolve(OUT, name), fullPage: full })
    console.log('  shot:', name)
  }

  const go = async (path) => {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle2', timeout: 60000 })
  }

  // The (customer) layout forces lang from the Odoo profile on mount, overriding
  // the cookie. Click the in-app "עב" toggle after each load to force Hebrew RTL
  // (this also triggers the per-language product refetch).
  const toHebrew = async () => {
    try {
      await page.evaluate(() => {
        const he = Array.from(document.querySelectorAll('button')).find(
          (b) => (b.textContent || '').trim() === 'עב'
        )
        if (he) he.click()
      })
    } catch {}
    await sleep(1600)
  }

  // 1) Login page (still logged out) — Hebrew
  console.log('login page...')
  await go('/login')
  await forceHebrew()
  await go('/login') // reload so SSR picks up lang=he
  await shoot('login.png')

  // 2) Authenticate via the real form
  console.log('authenticating as', LOGIN)
  await page.type('#email', LOGIN, { delay: 15 })
  await page.type('#password', PASSWORD, { delay: 15 })
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await sleep(1500)
  if (page.url().includes('/login')) {
    throw new Error('Login failed — still on /login. Check credentials.')
  }
  console.log('logged in, now at', page.url())
  await forceHebrew() // ensure RTL persists post-login

  // --- flow helpers ---
  // The products toolbar search is a controlled React input; synthetic keystrokes
  // don't register, so set the value via the native setter + bubbling input event.
  // Target the widest visible placeholder input (the full-width toolbar search).
  const typeSearch = async (q) => {
    await page.waitForSelector('input[placeholder]', { timeout: 8000 })
    await page.evaluate((val) => {
      const input = Array.from(document.querySelectorAll('input[placeholder]'))
        .filter((i) => i.offsetParent !== null)
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, q)
    await sleep(2300)
  }
  const clearCart = async () => {
    try {
      await go('/cart')
      await toHebrew()
      await sleep(900)
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) =>
          /נקה עגלה|רוקן|clear cart|הסר הכל/i.test(x.textContent || ''))
        if (b) b.click()
      })
      await sleep(1200)
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) =>
          /אישור|כן|מחק|confirm|yes/i.test(x.textContent || ''))
        if (b) b.click()
      })
      await sleep(1400)
    } catch (e) { console.warn('  clearCart skipped:', e.message) }
  }

  // Start from a clean cart so the cart shot shows only the demo item.
  console.log('clearing cart...')
  await clearCart()

  // 3) Catalogue — sort by "recently ordered" to surface popular products
  console.log('catalogue...')
  await go('/products')
  await toHebrew()
  await sleep(800)
  try { await page.select('select', 'recently_ordered'); await sleep(1900) }
  catch (e) { console.warn('  sort select skipped:', e.message) }
  await shoot('products.png')

  // 4) Search — use the global search overlay (clean results list, no stock badges;
  // the products-grid search endpoint marks every result out-of-stock).
  console.log('search overlay (Bamba)...')
  try {
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Search"]')
      if (b) b.click()
    })
    await page.waitForSelector('.fixed.inset-0 input', { timeout: 6000 })
    await sleep(400)
    await page.evaluate((val) => {
      const input = document.querySelector('.fixed.inset-0 input')
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, 'Bamba')
    await sleep(2300)
  } catch (e) { console.warn('  search overlay failed:', e.message) }
  await shoot('search.png')
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(400)

  // 5) Product detail — the Bamba 25 gr example (in stock)
  console.log('product detail (Bamba 25 gr)...')
  await typeSearch('Bamba')
  let bambaHref = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/products/"]'))
    const byText = (re) => links.find((a) => re.test(a.textContent || ''))
    const a = byText(/Bamba.*25\s*gr|במבה.*25/i) || byText(/Bamba|במבה/i)
    return a ? a.getAttribute('href') : null
  })
  if (!bambaHref) { bambaHref = '/products/2691'; console.warn('  using known Bamba 25gr id 2691') }
  await go(bambaHref); await toHebrew(); await sleep(1200)
  await shoot('product.png')

  // Add Bamba to the cart so the cart/checkout shots are populated and relevant.
  let addedToCart = false
  try {
    const clicked = await page.evaluate(() => {
      const add = Array.from(document.querySelectorAll('button')).find((b) =>
        /הוסף לעגלה|הוסף|add to cart|לעגלה/i.test(b.textContent || ''))
      if (add && !add.disabled) { add.click(); return true }
      return false
    })
    if (clicked) { addedToCart = true; await sleep(2800) }
  } catch (e) {
    console.warn('  add-to-cart skipped:', e.message)
  }

  // 6) Cart
  console.log('cart...')
  await go('/cart')
  await toHebrew()
  await sleep(1200)
  await shoot('cart.png')

  // 7) Checkout
  console.log('checkout...')
  await go('/checkout')
  await toHebrew()
  await sleep(1500)
  await shoot('checkout.png')

  // 8) Orders
  console.log('orders...')
  await go('/orders')
  await toHebrew()
  await sleep(1200)
  await shoot('orders.png')

  // 9) Invoices
  console.log('invoices...')
  await go('/invoices')
  await toHebrew()
  await sleep(1200)
  await shoot('invoices.png')

  // 10) New arrivals (extras)
  console.log('new arrivals...')
  await go('/new-arrivals')
  await toHebrew()
  await sleep(1200)
  await shoot('newarrivals.png')

  // Cleanup: clear the cart, leaving the account as we found it.
  console.log('cleanup...')
  if (addedToCart) await clearCart()

  await browser.close()
  console.log('Done. Screenshots in', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
