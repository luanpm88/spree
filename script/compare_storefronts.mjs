// Screenshot two storefronts side by side, to answer "can the new frontend look like
// the old one" with a picture instead of a promise.
//
//   node script/compare_storefronts.mjs <url-a> <url-b>
//
// Defaults compare the client's live Rails storefront against our stock Next.js one.
// Output in tmp/storefronts/, gitignored.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// No default. This used to fall back to a client shop URL, which put the client's
// domain into a public repo.
const [A, B_ARG] = process.argv.slice(2)
if (!A) {
  console.error('usage: node script/compare_storefronts.mjs <url-a> [url-b]')
  process.exit(1)
}
const B = process.argv[3] ?? 'http://localhost:3001/'
const OUT = 'tmp/storefronts'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

for (const [name, url] of [['a-current-rails', A], ['b-stock-nextjs', B]]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    // Cookie banners and newsletter popups cover the design in a screenshot.
    for (const t of ['Accept', 'Got it', 'Close', 'Dismiss', 'No thanks']) {
      await page.getByRole('button', { name: t, exact: false }).first()
          .click({ timeout: 1200 }).catch(() => {})
    }
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${name}.png` })
    await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true })
    const title = await page.title()
    console.log(`  ${name.padEnd(16)} ${url}\n${' '.repeat(18)}${title}`)
  } catch (e) {
    console.log(`  ${name.padEnd(16)} FAILED  ${e.message.split('\n')[0]}`)
  }
  await ctx.close()
}

await browser.close()
console.log(`\nscreenshots in ${OUT}/`)
