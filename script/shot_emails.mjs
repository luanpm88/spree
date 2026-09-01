// Screenshot the emails that changed this morning, from the HTML the shipped
// image actually rendered, not from a local re-render.
//
//   node shot_emails.mjs <outdir> <file.html> [file.html ...]
//
// Email is fixed width by design, so the viewport is set wide enough that the
// table is not clipped and the shot is the message as a client would show it.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'

const [outdir, ...files] = process.argv.slice(2)
mkdirSync(outdir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 1200 }, deviceScaleFactor: 2 })

for (const f of files) {
  const html = readFileSync(f, 'utf8')
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  // Remote images in email 404 often enough that waiting on them stalls the run.
  await page.waitForTimeout(1200)
  const name = basename(f).replace(/\.html$/, '')
  const out = `${outdir}/${name}.png`
  await page.screenshot({ path: out, fullPage: true })
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())
  console.log(`  ${name}  ${text.length} chars of text`)
  for (const marker of ['Trusted by Businesses', 'Awaiting Final Approval', 'Guardian', 'HSBC', 'Why you']) {
    if (text.includes(marker)) console.log(`      contains: ${marker}`)
  }
}
await browser.close()
