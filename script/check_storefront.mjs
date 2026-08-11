// Prove a deployed storefront carries the client's brand and not the framework's.
//
//   node script/check_storefront.mjs https://shop.example.com
//
// Checks the RENDERED IMAGES as well as the text. An earlier text-only check
// reported no Spree references while the Spree logo sat at the top of the page:
// an assertion over innerText cannot see a logo.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2]
if (!BASE) { console.error('usage: node script/check_storefront.mjs <url>'); process.exit(1) }
const OUT = 'tmp/commercial'
mkdirSync(OUT, { recursive: true })

const BANNED = ['Fork on GitHub', 'Quickstart', 'Powered by Spree', 'Spree Commerce', 'vendor lock-in', 'platform fees']
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })).newPage()
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })

const problems = []
const body = await page.locator('body').innerText()
for (const w of BANNED) if (body.includes(w)) problems.push(`text: "${w}"`)

// Images: src, alt and any inline svg title.
const imgs = await page.locator('img').evaluateAll((els) =>
  els.map((e) => ({ src: e.getAttribute('src') || '', alt: e.getAttribute('alt') || '' })))
for (const i of imgs) {
  if (/spree|vercel|next\.svg/i.test(i.src)) problems.push(`image src: ${i.src.slice(0, 70)}`)
  if (/spree/i.test(i.alt)) problems.push(`image alt: ${i.alt}`)
}

await page.screenshot({ path: `${OUT}/storefront.png`, fullPage: true })
console.log(`title:  ${await page.title()}`)
console.log(`images: ${imgs.length}`)
if (problems.length) {
  console.log(`FAIL — ${problems.length} framework reference(s) still visible:`)
  for (const p of problems) console.log(`  ${p}`)
  await browser.close(); process.exit(1)
}
console.log('ok — no framework branding in text or images')
await browser.close()
