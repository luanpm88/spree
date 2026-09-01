// How long does a signed in admin screen actually take, per shop.
//
//   node script/measure_admin.mjs https://store.example.com creds.txt
//
// The client reported "the admin of the new shops is very slow". The sign in page
// answers in one to three seconds, but that page carries no data of his. What he
// is using is the orders list and the products list on a shop with real rows in
// it, and those are a different weight entirely, so this signs in and times them.
//
// Credentials come from a file, never from the command line: an argument is
// visible in ps to anyone on the machine, and these are his.
//
// Each page is timed TWICE. The first includes whatever the server had to warm;
// the second is what he experiences on the fifth click. Reporting only the first
// would overstate it and only the second would understate it.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const [base, credFile] = process.argv.slice(2)
if (!base || !credFile) {
  console.error('usage: node script/measure_admin.mjs <https://host> <creds file>')
  process.exit(2)
}

// The file is three lines: a label, the email, the password.
const lines = readFileSync(credFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const email = lines.find((l) => l.includes('@'))
const password = lines[lines.indexOf(email) + 1] || lines[lines.length - 1]
if (!email || !password) {
  console.error('could not read an email and a password from that file')
  process.exit(2)
}

const PAGES = [
  ['dashboard', '/admin'],
  ['orders', '/admin/orders'],
  ['products', '/admin/products'],
  ['customers', '/admin/customers'],
]

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

const t0 = Date.now()
await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.fill('input[type="email"], input[name*="email"]', email)
await page.fill('input[type="password"], input[name*="password"]', password)
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
  page.click('button[type="submit"], input[type="submit"]'),
])
const signedIn = !/sign_in|login/.test(page.url())
console.log(`  sign in: ${signedIn ? 'ok' : 'FAILED'}  ${((Date.now() - t0) / 1000).toFixed(2)}s`)
if (!signedIn) {
  console.log(`  landed on ${page.url()}`)
  await browser.close()
  process.exit(1)
}

for (const [name, path] of PAGES) {
  const times = []
  for (let i = 0; i < 2; i++) {
    const t = Date.now()
    await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
    times.push((Date.now() - t) / 1000)
  }
  // Row count, so a fast page is not fast because it rendered nothing.
  const rows = await page.locator('table tbody tr').count().catch(() => 0)
  console.log(`  ${name.padEnd(11)} ${times[0].toFixed(2)}s cold, ${times[1].toFixed(2)}s warm, ${rows} rows`)
}
await browser.close()
