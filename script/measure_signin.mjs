// Where do the thirteen seconds of an admin sign in go.
//
//   node script/measure_signin.mjs https://store.example.com creds.txt
//
// The admin pages themselves answer in under two seconds; signing in takes ten
// times that, so "the admin is slow" is really "getting in is slow". This splits
// the sign in into its three parts so the next step is aimed at the right one:
//
//   GET   the form
//   POST  the credentials, which is where password hashing happens
//   GET   whatever it redirects to
//
// Timed from the network events rather than from the page object, because a
// navigation that ends in a redirect hides the cost of the request that caused it.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const [base, credFile] = process.argv.slice(2)
const lines = readFileSync(credFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const email = lines.find((l) => l.includes('@'))
const password = lines[lines.indexOf(email) + 1] || lines[lines.length - 1]

const browser = await chromium.launch()
const page = await browser.newContext().then((c) => c.newPage())

const marks = []
page.on('request', (r) => { if (r.isNavigationRequest()) marks.push({ url: r.url(), method: r.method(), start: Date.now() }) })
page.on('response', (r) => {
  const m = marks.find((x) => x.url === r.url() && !x.done)
  if (m) { m.done = true; m.ms = Date.now() - m.start; m.status = r.status() }
})

let t = Date.now()
await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 })
const getForm = Date.now() - t

await page.fill('input[type="email"], input[name*="email"]', email)
await page.fill('input[type="password"], input[name*="password"]', password)

t = Date.now()
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
  page.click('button[type="submit"], input[type="submit"]'),
])
const submit = Date.now() - t

console.log(`  GET  form      ${(getForm / 1000).toFixed(2)}s`)
console.log(`  POST + follow  ${(submit / 1000).toFixed(2)}s`)
console.log(`  signed in: ${!/sign_in|login/.test(page.url())}`)
console.log('  từng request điều hướng:')
for (const m of marks) {
  if (m.ms === undefined) continue
  console.log(`    ${String(m.method).padEnd(5)} ${String(m.status).padEnd(4)} ${(m.ms / 1000).toFixed(2)}s  ${m.url.replace(base, '')}`)
}
await browser.close()
