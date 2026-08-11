// Prove a deployed Spree admin actually lets a human in, before anyone is told it is ready.
//
//   node script/check_admin_login.mjs https://store.example.com admin@example.com 'password'
//
// The assertion is POSITIVE: the admin dashboard must be visibly present. An earlier
// version asserted the absence of "sign_in" from the URL, which reported success on a
// chrome-error:// page — the browser had failed to load anything at all and the check
// could not tell that apart from a working login. Absence of a failure marker is not
// evidence of success.
//
// Exits non-zero on any failure, and writes screenshots either way.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [BASE, EMAIL, PASS] = process.argv.slice(2)
if (!BASE || !EMAIL || !PASS) {
  console.error('usage: node script/check_admin_login.mjs <base-url> <email> <password>')
  process.exit(1)
}

const OUT = 'tmp/commercial'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const netErrors = []
page.on('requestfailed', (r) => netErrors.push(`${r.failure()?.errorText} ${r.url()}`))
page.on('response', (r) => { if (r.status() >= 500) netErrors.push(`HTTP ${r.status()} ${r.url()}`) })

const fail = async (msg) => {
  console.error(`FAIL  ${msg}`)
  if (netErrors.length) console.error('network:\n  ' + [...new Set(netErrors)].slice(0, 8).join('\n  '))
  try { await page.screenshot({ path: `${OUT}/fail.png`, fullPage: true }) } catch {}
  await browser.close()
  process.exit(1)
}

console.log(`1. loading ${BASE}/admin`)
try {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 })
} catch (e) {
  await fail(`could not load the admin: ${e.message}`)
}
console.log(`   landed on ${page.url()}`)
await page.screenshot({ path: `${OUT}/01-login.png` })

const emailField = page.locator('input[type="email"], input[name*="email" i]').first()
const passField = page.locator('input[type="password"]').first()
if (!(await emailField.count()) || !(await passField.count())) await fail('no login form on the page')

console.log('2. submitting credentials')
await emailField.fill(EMAIL)
await passField.fill(PASS)
await page.locator('button[type="submit"], input[type="submit"]').first().click()

// Wait for the app to settle rather than for a particular URL: Spree redirects more
// than once and the final path differs per version.
try {
  await page.waitForLoadState('networkidle', { timeout: 45000 })
} catch { /* fall through to the positive assertion below */ }

const url = page.url()
console.log(`   now at ${url}`)

if (url.startsWith('chrome-error')) await fail('the browser could not load the page after submit')

// The positive assertion. Any ONE of these only exists once authenticated.
const signals = {
  'logout control': page.locator('a[href*="sign_out"], form[action*="sign_out"]'),
  'products nav': page.locator('a[href*="/admin/products"]'),
  'orders nav': page.locator('a[href*="/admin/orders"]'),
}
const found = []
for (const [name, loc] of Object.entries(signals)) if (await loc.count()) found.push(name)

await page.screenshot({ path: `${OUT}/02-after-login.png`, fullPage: true })

if (!found.length) {
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)
  await fail(`logged in but no admin UI found. Page says: ${text}`)
}

console.log(`3. authenticated — found ${found.join(', ')}`)
console.log(`ok    admin login works at ${BASE}`)
console.log(`      screenshots in ${OUT}/`)
await browser.close()
