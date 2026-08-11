// Screenshot the deployed admin for a handover document.
//
//   node script/capture_commercial.mjs https://store.example.com email password
//
// Logs in first, then walks the pages a client actually cares about. Every shot is
// taken from the real deployment; nothing here is a mockup.
//
// Fails loudly if login does not work, because a handover built from screenshots of
// a login page is worse than no handover.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [BASE, EMAIL, PASS] = process.argv.slice(2)
if (!BASE || !EMAIL || !PASS) {
  console.error('usage: node script/capture_commercial.mjs <base-url> <email> <password>')
  process.exit(1)
}

const OUT = 'tmp/commercial'
mkdirSync(OUT, { recursive: true })

const PAGES = [
  ['dashboard', '/admin'],
  ['products', '/admin/products'],
  ['orders', '/admin/orders'],
  ['store-settings', '/admin/stores/edit'],
  ['payment-methods', '/admin/payment_methods'],
  ['shipping', '/admin/shipping_methods'],
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.locator('input[type="email"], input[name*="email" i]').first().fill(EMAIL)
await page.locator('input[type="password"]').first().fill(PASS)
await page.locator('button[type="submit"], input[type="submit"]').first().click()
await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})

if (!(await page.locator('a[href*="/admin/products"]').count())) {
  console.error('FAIL  login did not reach the admin; refusing to screenshot a login page')
  await page.screenshot({ path: `${OUT}/fail.png`, fullPage: true })
  await browser.close()
  process.exit(1)
}
console.log('logged in')

for (const [name, path] of PAGES) {
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 })
    // Dismiss the flash so it does not sit across every screenshot.
    await page.locator('[data-action*="dismiss"], .flash button, [aria-label="Close"]').first()
      .click({ timeout: 1500 }).catch(() => {})
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
    console.log(`  ${name.padEnd(18)} ${path}`)
  } catch (e) {
    console.log(`  ${name.padEnd(18)} SKIPPED (${e.message.split('\n')[0].slice(0, 60)})`)
  }
}

await browser.close()
console.log(`screenshots in ${OUT}/`)
