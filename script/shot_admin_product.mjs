// Screenshot the Media panel of a product in the admin, which is where the client
// reported a broken image.
//
//   node script/shot_admin_product.mjs https://store.example.com creds.txt "Flip-Top" out.png
//
// He sent a screenshot of the fault, so the answer should be a screenshot of the
// same panel, not a sentence saying it is fixed.
//
// It also reads back whether the <img> actually decoded, because a picture that
// failed to load and one that loaded are hard to tell apart in a thumbnail, and
// naturalWidth is the only honest test.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const [base, credFile, needle, out] = process.argv.slice(2)
if (!base || !credFile || !needle || !out) {
  console.error('usage: node script/shot_admin_product.mjs <host> <creds> <search> <out.png>')
  process.exit(2)
}
const lines = readFileSync(credFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const email = lines.find((l) => l.includes('@'))
const password = lines[lines.indexOf(email) + 1] || lines[lines.length - 1]

const browser = await chromium.launch()
const page = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })
  .then((c) => c.newPage())

await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.fill('input[type="email"], input[name*="email"]', email)
await page.fill('input[type="password"], input[name*="password"]', password)
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
  page.click('button[type="submit"], input[type="submit"]'),
])
if (/sign_in/.test(page.url())) { console.error('  sign in failed'); await browser.close(); process.exit(1) }

await page.goto(`${base}/admin/products?q%5Bmulti_search%5D=${encodeURIComponent(needle)}`,
  { waitUntil: 'domcontentloaded', timeout: 90000 })
const link = page.locator('table tbody tr a').first()
if (!(await link.count())) { console.error(`  không tìm thấy sản phẩm khớp ${needle}`); await browser.close(); process.exit(1) }
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), link.click()])
console.log(`  sản phẩm: ${(await page.title()).slice(0, 70)}`)

// Give the media thumbnails their chance, then ask each one whether it decoded.
await page.waitForTimeout(3000)
const imgs = await page.evaluate(() =>
  [...document.querySelectorAll('img')]
    .filter((i) => /active_storage|rails\/|\/assets\/.*\.(jpg|png)/.test(i.currentSrc || i.src))
    .map((i) => ({ src: (i.currentSrc || i.src).slice(-60), w: i.naturalWidth, h: i.naturalHeight })))
console.log(`  ảnh trong trang: ${imgs.length}`)
for (const i of imgs.slice(0, 6)) {
  console.log(`    ${i.w > 0 ? 'HIỆN ' : 'HỎNG '} ${i.w}x${i.h}  ...${i.src}`)
}
await page.screenshot({ path: out, fullPage: true })
console.log(`  đã chụp ${out}`)
await browser.close()
