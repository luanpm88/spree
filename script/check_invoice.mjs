// Proves the printable invoice renders, carries the order, and is reachable from the admin
// order page — in a real browser, because that is the only place a print stylesheet and an
// overridden-nothing partial hook can be trusted.
//
//   node script/check_invoice.mjs http://localhost:3000 spree@example.com password or_EfhxLZ9ck8
//
// Admin URLs take a PREFIXED order id. A raw id redirects and looks exactly like a broken
// page; see script/check_note_field.mjs for the same lesson on customers.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [BASE, EMAIL, PASS, ORDER] = process.argv.slice(2)
if (!BASE || !EMAIL || !PASS || !ORDER) {
  console.error('usage: node script/check_invoice.mjs <base-url> <admin-email> <password> <order-prefixed-id>')
  process.exit(1)
}
const OUT = 'tmp/invoice'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage()
const serverErrors = []
page.on('response', (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`) })

async function fail(msg) {
  await page.screenshot({ path: `${OUT}/fail.png`, fullPage: true })
  console.error(`FAIL  ${msg}`)
  if (serverErrors.length) console.error(`      5xx: ${serverErrors.join(', ')}`)
  await browser.close()
  process.exit(1)
}

await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.locator('input[type="email"], input[name*="email" i]').first().fill(EMAIL)
await page.locator('input[type="password"]').first().fill(PASS)
await Promise.all([
  page.waitForLoadState('domcontentloaded'),
  page.locator('button[type="submit"], input[type="submit"]').first().click(),
])
if (/sign_in/.test(page.url())) await fail(`still on sign in: ${page.url()}`)

// 1. the link is on the order page, from the registered partial and no view override
const orderUrl = `${BASE}/admin/orders/${ORDER}`
const shown = await page.goto(orderUrl, { waitUntil: 'domcontentloaded' })
if (!shown || shown.status() !== 200) await fail(`${orderUrl} answered ${shown && shown.status()}`)
const link = page.locator(`a[href="/admin/orders/${ORDER}/invoice"]`)
if (!(await link.count())) await fail('the Print invoice link is not on the order page')

// 2. the invoice itself
const invUrl = `${BASE}/admin/orders/${ORDER}/invoice`
const inv = await page.goto(invUrl, { waitUntil: 'domcontentloaded' })
if (!inv || inv.status() !== 200) await fail(`${invUrl} answered ${inv && inv.status()}`)

const html = await page.content()
if (html.includes('translation_missing')) {
  await fail(`translation_missing: ${(html.match(/translation missing: [^"<]+/) || ['?'])[0]}`)
}
const leftover = html.match(/%\{(\w+)\}/g)
if (leftover) await fail(`unfilled interpolation: ${[...new Set(leftover)].join(', ')}`)

// It must carry the things an invoice is for.
for (const [label, needle] of [
  ['the order number', 'R-INVOICE-TEST'],
  ['the customer name', 'Whitcombe'],
  ['a grand total', 'Total'],
]) {
  if (!html.toLowerCase().includes(needle.toLowerCase())) {
    await fail(`the invoice does not carry ${label}`)
  }
}

const rows = await page.locator('table.items tbody tr').count()
if (rows < 1) await fail('no line item rows')

// Per row: a DESCRIPTION and a TOTAL are non-negotiable. A SKU is not — a product may
// genuinely have none, and an earlier version of this check failed on a fixture whose
// first variant had a blank sku, which is the data being honest rather than a fault. So
// require at least one SKU somewhere, and a description on every line.
const cells = await page.locator('table.items tbody tr').evaluateAll((trs) =>
  trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
)
const blankDescription = cells.findIndex((c) => !c[1])
if (blankDescription !== -1) await fail(`line ${blankDescription + 1} has no description`)
const blankTotal = cells.findIndex((c) => !c[4])
if (blankTotal !== -1) await fail(`line ${blankTotal + 1} has no total`)
if (!cells.some((c) => c[0])) await fail('not one line item shows a SKU')

// The admin chrome must NOT be there: this is a standalone document.
if (await page.locator('nav a[href*="/admin/products"]').count()) {
  await fail('admin navigation rendered inside the invoice — layout false is not in effect')
}
if (serverErrors.length) await fail(`5xx: ${serverErrors.join(', ')}`)

await page.screenshot({ path: `${OUT}/screen.png`, fullPage: true })

// 3. it must actually print. Emulate print media and confirm the toolbar hides.
await page.emulateMedia({ media: 'print' })
const toolbarVisible = await page.locator('.toolbar').isVisible()
if (toolbarVisible) await fail('the Print button is still visible in print media')
await page.pdf({ path: `${OUT}/invoice.pdf`, format: 'A4', printBackground: true })

console.log(`ok    invoice renders, ${rows} line items, linked from the order page, and prints`)
console.log(`      ${OUT}/invoice.pdf`)
await browser.close()
