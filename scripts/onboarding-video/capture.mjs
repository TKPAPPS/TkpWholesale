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

  // 3) Catalogue
  console.log('catalogue...')
  await go('/products')
  await toHebrew()
  await sleep(1200)
  await shoot('products.png')

  // 4) Search — type into the search field, capture results
  console.log('search...')
  try {
    const searchSel = 'input[type="search"], input[placeholder]'
    await page.waitForSelector(searchSel, { timeout: 5000 })
    await page.click(searchSel)
    await page.type(searchSel, 'שמן', { delay: 40 })
    await sleep(1800)
  } catch (e) {
    console.warn('  search field not found, capturing catalogue as-is:', e.message)
  }
  await shoot('search.png')

  // 5) Product detail — open the first product card
  console.log('product detail...')
  await go('/products')
  await toHebrew()
  await sleep(800)
  const productHref = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/products/"]')
    return a ? a.getAttribute('href') : null
  })
  if (productHref) {
    await go(productHref)
    await toHebrew()
    await sleep(1200)
  } else {
    console.warn('  no product link found; capturing catalogue instead')
  }
  await shoot('product.png')

  // Best-effort: add this product to the cart so the cart/checkout shots are populated.
  let addedToCart = false
  try {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const add = btns.find((b) => /הוסף|add to cart|לעגלה/i.test(b.textContent || ''))
      if (add) { add.click(); return true }
      return false
    })
    if (clicked) { addedToCart = true; await sleep(2500) }
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

  // 11) Favorites (extras, optional)
  console.log('favorites...')
  await go('/favorites')
  await toHebrew()
  await sleep(1000)
  await shoot('favorites.png')

  // Cleanup: remove the line we optimistically added, leaving the account clean.
  if (addedToCart) {
    console.log('cleaning up cart line added for the demo...')
    try {
      await go('/cart')
      await sleep(1000)
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const clear = btns.find((b) => /רוקן|clear|הסר הכל|מחק/i.test(b.textContent || ''))
        if (clear) clear.click()
      })
      await sleep(2000)
      console.log('  cart cleanup attempted')
    } catch (e) {
      console.warn('  cart cleanup failed (remove the demo line manually):', e.message)
    }
  }

  await browser.close()
  console.log('Done. Screenshots in', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
