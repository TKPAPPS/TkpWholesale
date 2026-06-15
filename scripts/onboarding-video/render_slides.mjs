// Render each slide to a 3840x2160 PNG (1920x1080 @2x) with the system Chrome.
// Slides are hand-built HTML/CSS; screenshots are embedded WHOLE (object-fit: contain).

import puppeteer from 'puppeteer-core'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadContent, wrap } from './_lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(__dirname, 'assets/shots')
const OUT = resolve(__dirname, 'assets/slides')
const SUBS = resolve(__dirname, 'assets/subs')
mkdirSync(OUT, { recursive: true })
mkdirSync(SUBS, { recursive: true })

const CHROME =
  process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CSS = readFileSync(resolve(__dirname, 'slides/slide.css'), 'utf8')

// Real brand logo (from src/app/icon.svg). dir="ltr" is required so the Latin
// text isn't reversed by the RTL document (matches the app's Logo.tsx).
const LOGO = `<svg viewBox="0 0 420 150" xmlns="http://www.w3.org/2000/svg" dir="ltr" direction="ltr" aria-label="The Kosher Place">
  <text x="6" y="30" font-family="Georgia, 'Times New Roman', serif" font-size="19" font-weight="700" fill="#C8A84B" letter-spacing="8">THE</text>
  <text x="2" y="118" font-family="Georgia, 'Times New Roman', serif" font-size="90" font-weight="700" fill="#6B1535">KOSHER</text>
  <text x="250" y="143" font-family="Georgia, 'Times New Roman', serif" font-size="19" font-weight="700" fill="#C8A84B" letter-spacing="8">PLACE</text>
</svg>`

// Friendly URL shown in the browser chrome per screenshot.
const URLS = {
  'login.png': 'tkp-wholesale.vercel.app/login',
  'products.png': 'tkp-wholesale.vercel.app/products',
  'search.png': 'tkp-wholesale.vercel.app/products',
  'product.png': 'tkp-wholesale.vercel.app/products',
  'cart.png': 'tkp-wholesale.vercel.app/cart',
  'checkout.png': 'tkp-wholesale.vercel.app/checkout',
  'orders.png': 'tkp-wholesale.vercel.app/orders',
  'invoices.png': 'tkp-wholesale.vercel.app/invoices',
  'newarrivals.png': 'tkp-wholesale.vercel.app/new-arrivals',
}

const esc = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function slideBody(s) {
  if (s.type === 'title') {
    return `<div class="slide slide--title">
      <div class="logo logo-white">${LOGO}</div>
      <div class="rule"></div>
      <h1>${esc(s.heading)}</h1>
      <div class="sub">${esc(s.sub || '')}</div>
    </div>`
  }
  if (s.type === 'cta') {
    return `<div class="slide slide--cta">
      <h1>${esc(s.heading)}</h1>
      <div class="sub">${esc(s.sub || '')}</div>
      <div class="rule"></div>
      <div class="logo logo-white">${LOGO}</div>
    </div>`
  }
  if (s.type === 'section') {
    const bullets = (s.bullets || [])
      .map((b) => `<li>${esc(b)}</li>`)
      .join('')
    return `<div class="slide slide--section">
      <div class="kicker">The Kosher Place Wholesale</div>
      <h1>${esc(s.heading)}</h1>
      <div class="sub">${esc(s.sub || '')}</div>
      <ul>${bullets}</ul>
      <div class="corner-logo logo">${LOGO}</div>
    </div>`
  }
  // shot — embed as base64 data URI (setContent docs can't load file:// subresources)
  const imgPath = resolve(SHOTS, s.shot)
  const imgSrc = existsSync(imgPath)
    ? `data:image/png;base64,${readFileSync(imgPath).toString('base64')}`
    : ''
  const url = URLS[s.shot] || 'tkp-wholesale.vercel.app'
  return `<div class="slide slide--shot">
    <div class="shot-header">
      <div class="logo">${LOGO}</div>
      <div class="divider"></div>
      <div class="titles">
        <h1>${esc(s.heading)}</h1>
        <div class="sub">${esc(s.sub || '')}</div>
      </div>
    </div>
    <div class="shot-stage">
      <div class="browser">
        <div class="bar">
          <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
          <span class="url">${esc(url)}</span>
        </div>
        ${imgSrc ? `<img src="${imgSrc}" alt="">` : `<div style="padding:120px;text-align:center;color:#b08;">(screenshot missing: ${esc(s.shot)})</div>`}
      </div>
    </div>
  </div>`
}

const HEAD = `<meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>`

function html(s) {
  return `<!doctype html><html lang="he" dir="rtl"><head>${HEAD}</head>
  <body>${slideBody(s)}</body></html>`
}

// Transparent subtitle overlay (baked over the video by ffmpeg overlay).
function subtitleHtml(s) {
  const lines = wrap(s.narration, 46).map((l) => esc(l)).join('<br>')
  return `<!doctype html><html lang="he" dir="rtl"><head>${HEAD}</head>
  <body class="subtitle"><div class="subwrap"><div class="subbox"><p>${lines}</p></div></div></body></html>`
}

const main = async () => {
  const { slides } = loadContent()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
  })
  // Resolve when web fonts settle, but never block more than `ms`.
  const fontsReady = (ms = 5000) =>
    page.evaluate(
      (cap) =>
        Promise.race([
          (document.fonts ? document.fonts.ready : Promise.resolve()),
          new Promise((r) => setTimeout(r, cap)),
        ]),
      ms
    )

  const page = await browser.newPage()
  for (const s of slides) {
    // slide background
    await page.setContent(html(s), { waitUntil: 'load', timeout: 20000 })
    await fontsReady()
    await new Promise((r) => setTimeout(r, 250))
    await page.screenshot({ path: resolve(OUT, `${s.id}.png`) })

    // transparent subtitle overlay
    await page.setContent(subtitleHtml(s), { waitUntil: 'load', timeout: 20000 })
    await fontsReady()
    await new Promise((r) => setTimeout(r, 120))
    await page.screenshot({ path: resolve(SUBS, `${s.id}.png`), omitBackground: true })

    console.log('  slide + subtitle:', s.id)
  }
  await browser.close()
  console.log('Slides ->', OUT, '\nSubtitles ->', SUBS)
}

main().catch((e) => { console.error(e); process.exit(1) })
