// Which files make the admin sign in page take nine seconds.
//
//   node script/measure_assets.mjs https://store.example.com
//
// The navigation requests on that page add up to under a second of server time,
// and the page still takes nine. So the time is in what the page then asks for:
// stylesheets, scripts, fonts and images. This lists every one of them by how
// long it took and how big it was, slowest first.
//
// Nothing is signed in here. The sign in page is public and it is the page the
// client is waiting on.
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) { console.error('usage: node script/measure_assets.mjs <https://host>'); process.exit(2) }

const browser = await chromium.launch()
const page = await browser.newContext().then((c) => c.newPage())

const seen = new Map()
page.on('request', (r) => seen.set(r, { url: r.url(), type: r.resourceType(), start: Date.now() }))
page.on('response', async (r) => {
  const m = seen.get(r.request())
  if (!m) return
  m.ms = Date.now() - m.start
  m.status = r.status()
  m.bytes = Number(r.headers()['content-length'] || 0)
})

const t = Date.now()
await page.goto(`${base}/admin`, { waitUntil: 'load', timeout: 90000 })
const total = Date.now() - t

const rows = [...seen.values()].filter((m) => m.ms !== undefined)
rows.sort((a, b) => b.ms - a.ms)

console.log(`  trang tải xong trong ${(total / 1000).toFixed(2)}s, ${rows.length} request`)
console.log(`  ${'thời gian'.padEnd(10)} ${'kích thước'.padEnd(11)} ${'loại'.padEnd(11)} url`)
for (const m of rows.slice(0, 14)) {
  const kb = m.bytes ? `${Math.round(m.bytes / 1024)} KB` : '?'
  console.log(`  ${(`${(m.ms / 1000).toFixed(2)}s`).padEnd(10)} ${kb.padEnd(11)} ${String(m.type).padEnd(11)} ${m.url.replace(base, '').slice(0, 76)}`)
}
const slow = rows.filter((m) => m.ms > 1000)
console.log(`\n  ${slow.length} request mất hơn 1 giây, tổng ${(slow.reduce((s, m) => s + m.ms, 0) / 1000).toFixed(1)}s`)
await browser.close()
