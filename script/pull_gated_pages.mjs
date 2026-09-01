// Read the pages of a shop that sits behind a login, using the account its owner
// gave us for exactly that.
//
//   node script/pull_gated_pages.mjs https://shop.example creds.txt out/dir
//
// Why this exists: the wholesale shop answers 302 to sign in on every path, so
// script/pull_page_copy.py sees nothing. The owner supplied a test account in the
// task he raised, so the words on those pages are readable rather than something
// to ask him to retype.
//
// READ ONLY. It signs in, visits, and writes what it saw. Nothing is submitted
// beyond the sign in form itself, no cart is touched and no setting is changed,
// because this is his live shop serving real customers.
//
// Credentials come from a file, never an argument: an argument is visible in ps
// to anyone on the machine.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const [base, credFile, outDir] = process.argv.slice(2)
if (!base || !credFile || !outDir) {
  console.error('usage: node script/pull_gated_pages.mjs <https://host> <creds file> <out dir>')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const lines = readFileSync(credFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const email = lines.find((l) => l.includes('@'))
const password = lines[lines.indexOf(email) + 1]
if (!email || !password) { console.error('no email and password in that file'); process.exit(2) }

const PATHS = [
  '/', '/pages/about', '/pages/faq', '/pages/ordering-guide',
  '/pages/brand-assets', '/pages/downloads', '/pages/resources',
  '/policies/terms-of-service', '/policies/privacy-policy',
  '/policies/returns-policy', '/policies/shipping-policy',
]

const browser = await chromium.launch()
const page = await browser.newContext().then((c) => c.newPage())

await page.goto(`${base}/user/sign_in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.fill('input[type="email"], input[name*="email"]', email)
await page.fill('input[type="password"], input[name*="password"]', password)
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
  page.click('button[type="submit"], input[type="submit"]'),
])
const inside = !/sign_in/.test(page.url())
console.log(`  sign in: ${inside ? 'ok' : 'FAILED, landed on ' + page.url()}`)
if (!inside) { await browser.close(); process.exit(1) }

for (const p of PATHS) {
  const res = await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null)
  const status = res ? res.status() : 0
  const redirected = /sign_in/.test(page.url())
  const name = (p === '/' ? 'home' : p.replace(/^\//, '').replace(/\//g, '-'))
  if (!res || status >= 400 || redirected) {
    console.log(`  ${name.padEnd(26)} ${status}${redirected ? ' (đẩy về sign in)' : ''}`)
    continue
  }
  const html = await page.content()
  // The readable text, so the copy can be compared without wading through markup.
  const text = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body
    return main.innerText.replace(/\n{3,}/g, '\n\n').trim()
  })
  writeFileSync(`${outDir}/${name}.html`, html)
  writeFileSync(`${outDir}/${name}.txt`, text)
  console.log(`  ${name.padEnd(26)} ${status}  ${text.length} ký tự`)
}
await browser.close()
