// Verifies the project dashboard actually renders, rather than assuming it does.
//
// It loads every tab in both themes, fails on any console error or page error, and
// asserts that content the JSON contains actually reached the DOM. The last part
// matters most: a dashboard that renders an empty table without complaining looks
// healthy and tells you nothing.
//
//   node script/check_dashboard.mjs                    # self-hosted, no setup needed
//   BASE=http://admin.spree.local node script/check_dashboard.mjs   # through nginx
//
// By default it serves dashboard/ itself on an ephemeral port, so the check does not
// depend on nginx running or on an /etc/hosts entry. Pointing BASE at the real
// hostname additionally proves the nginx vhost is wired up.
//
// Screenshots land in tmp/dashboard/ (gitignored).

import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const OUT = 'tmp/dashboard'
// Must match the TABS in dashboard/index.html. A tab missing here is a tab nothing
// checks, which is how a broken one ships looking fine.
const TABS = ['overview', 'waiting', 'their', 'work', 'risks', 'timeline', 'decisions', 'shipped', 'reference']

mkdirSync(OUT, { recursive: true })
const plan = JSON.parse(readFileSync('docs/plan.json', 'utf8'))

// Mirrors the nginx vhost: index.html at /, and docs/plan.json aliased to /plan.json
// so there is still only one copy of the source of truth.
let server = null
let BASE = process.env.BASE
if (!BASE) {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    try {
      if (path === '/plan.json') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(readFileSync('docs/plan.json'))
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(readFileSync('dashboard/index.html'))
      }
    } catch (e) {
      res.writeHead(500); res.end(String(e.message))
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  BASE = `http://127.0.0.1:${server.address().port}`
  console.log(`serving dashboard/ on ${BASE}`)
}

const problems = []
const browser = await chromium.launch()

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: theme,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()

  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${theme}] console: ${m.text()}`) })
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))

  for (const tab of TABS) {
    // Same-document navigation (only the hash changed) resolves to null rather than a
    // Response, which is expected — only assert the status when a real request happened.
    const res = await page.goto(`${BASE}/#${tab}`, { waitUntil: 'networkidle' })
    if (res && !res.ok()) problems.push(`[${theme}] ${tab}: HTTP ${res.status()}`)
    // The hash alone does not re-render when the page was already open on another
    // hash in this same context, so click the tab to be certain.
    await page.click(`[data-act="go"][data-to="${tab}"]`).catch(() => {})
    await page.waitForTimeout(250)

    const text = await page.locator('main').innerText()
    if (text.length < 40) problems.push(`[${theme}] ${tab}: main is essentially empty`)
    if (/undefined|\[object Object\]|NaN/.test(text)) {
      problems.push(`[${theme}] ${tab}: rendered a JS artefact (undefined / [object Object] / NaN)`)
    }
    await page.screenshot({ path: `${OUT}/${theme}-${tab}.png`, fullPage: true })
  }

  // Content assertions: prove the JSON reached the screen.
  await page.click('[data-act="go"][data-to="overview"]')
  await page.waitForTimeout(200)
  const overview = await page.locator('main').innerText()
  if (!overview.includes(plan.status.next_action.slice(0, 40))) problems.push(`[${theme}] overview is missing status.next_action`)
  if (!overview.includes(plan.status.headline.slice(0, 40))) problems.push(`[${theme}] overview is missing status.headline`)

  await page.click('[data-act="go"][data-to="waiting"]')
  await page.waitForTimeout(200)
  const waiting = await page.locator('main').innerText()
  for (const w of (plan.waiting_on_client ?? []).filter((x) => x.status === 'open')) {
    if (!waiting.includes(w.question.slice(0, 34))) problems.push(`[${theme}] waiting tab is missing: ${w.id}`)
  }

  // Row expansion has to actually reveal the detail.
  const before = (await page.locator('main').innerText()).length
  await page.locator('tr.r').first().click()
  await page.waitForTimeout(200)
  const after = (await page.locator('main').innerText()).length
  if (after <= before) problems.push(`[${theme}] clicking a row did not expand any detail`)

  // Filtering has to actually filter.
  await page.fill('[data-act="q"]', 'zzzznomatch')
  await page.waitForTimeout(200)
  if (!(await page.locator('main').innerText()).includes('Nothing outstanding')) {
    problems.push(`[${theme}] filter with no matches did not show the empty state`)
  }

  await ctx.close()
}

// Narrow viewport: the page must not scroll sideways.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const m = await ctx.newPage()
await m.goto(BASE, { waitUntil: 'networkidle' })
await m.waitForTimeout(400)
const { doc, win } = await m.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
if (doc > win + 1) problems.push(`mobile: body scrolls horizontally (${doc}px in a ${win}px viewport)`)
await m.screenshot({ path: `${OUT}/mobile-overview.png`, fullPage: true })
await ctx.close()

await browser.close()
server?.close()

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log(`\nok — ${TABS.length} tabs × 2 themes + mobile, no console errors, content assertions passed`)
console.log(`screenshots in ${OUT}/`)
