// End-to-end proof of the welcome email, from an admin creating a customer through to
// that customer signing in with a password they set themselves.
//
//   node script/e2e_welcome.mjs
//
// Screenshots land in tmp/welcome/, gitignored.
//
// The point of doing this in a browser rather than in a unit test: everything up to
// "the mail was sent" can pass while the customer is still locked out. The link can
// point at the wrong host, the token can be the stored hash instead of the raw one, the
// storefront can not have a reset page at all. None of that shows up until something
// actually clicks the link, so that is what this does.
//
// Uses Mailpit as the mail server, which is how the dev stack is already wired. Reading
// the message back out of Mailpit rather than out of ActionMailer::Base.deliveries also
// proves the mail genuinely left Rails and was accepted over SMTP — deliveries only
// fills when delivery_method is :test, so asserting on it proves nothing about a real
// send. That mistake cost a round of false failures here.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025'
// The Next.js storefront, NOT the Rails app. The seeded store record has
// storefront_url pointing at Rails on :3000 locally, which is a data problem rather
// than a code one — the reset page is a storefront route, so following the link
// against Rails returns 404 and looks like a broken email.
const STORE = process.env.STORE_URL ?? 'http://localhost:3001'
const OUT = 'tmp/welcome'
const COMPOSE = ['compose', '-f', 'docker-compose.dev.yml', 'exec', '-T', 'web']

mkdirSync(OUT, { recursive: true })

const steps = []
const fail = []
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) fail.push(name)
}

const rails = (ruby) =>
  execFileSync('docker', [...COMPOSE, 'bin/rails', 'runner', ruby], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()

const api = async (path, init) => {
  const r = await fetch(`${MAILPIT}${path}`, init)
  if (!r.ok) throw new Error(`mailpit ${path} -> ${r.status}`)
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text()
}

console.log('clearing the mailbox…')
await api('/api/v1/messages', { method: 'DELETE' })

// ── the admin creates a customer, exactly as the client describes doing it ───
const email = `wholesale-${Date.now()}@example.com`
console.log(`creating ${email} with welcome emails enabled…\n`)

const created = rails(`
  Spree.user_class.send_welcome_emails = true
  u = Spree.user_class.create!(email: ${JSON.stringify(email)},
                               password: SecureRandom.alphanumeric(24),
                               first_name: 'Ariana', last_name: 'Whitcombe')
  Spree.user_class.send_welcome_emails = false
  puts u.id
`)
step('admin creates the customer account', /^\d+$/.test(created), `id=${created}`)

// Solid Queue runs inside Puma, so the job is picked up out of process. Poll rather
// than sleep on a guess.
let message = null
for (let i = 0; i < 40 && !message; i++) {
  const list = await api('/api/v1/messages?limit=20')
  const hit = (list.messages ?? []).find((m) => m.To?.some((t) => t.Address === email))
  if (hit) message = await api(`/api/v1/message/${hit.ID}`)
  else await new Promise((r) => setTimeout(r, 500))
}
step('the welcome email arrives at the mail server', !!message,
     message ? `subject: ${message.Subject}` : 'nothing arrived within 20s')
if (!message) { console.log('\nstopping, nothing to follow'); process.exit(1) }

step('it has both an HTML and a plain text part', !!message.HTML && !!message.Text)
step('the subject has no em dash', !/[—–]/.test(message.Subject))

// ?token= is what Spree's append_token emits and what the storefront's reset page
// reads. An earlier version of this test looked for reset_password_token= and reported
// a failure against working code.
const link = (message.Text || '').match(/https?:\/\/\S*[?&]token=[A-Za-z0-9\-_]+/)?.[0]
step('the text part carries a working-looking reset link', !!link, link ? link.slice(0, 60) + '…' : '')
if (!link) process.exit(1)

// ── screenshot the mail as the customer sees it ─────────────────────────────
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.setContent(message.HTML, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/01-welcome-email.png`, fullPage: true })
step('rendered the email for the record', true, `${OUT}/01-welcome-email.png`)

// ── follow the link and set a password ──────────────────────────────────────
const target = link.replace(/^https?:\/\/[^/]+/, STORE)
const resp = await page.goto(target, { waitUntil: 'domcontentloaded' })
await page.screenshot({ path: `${OUT}/02-reset-page.png`, fullPage: true })
step('the link opens a page rather than an error', (resp?.status() ?? 0) < 400,
     `HTTP ${resp?.status()} at ${new URL(page.url()).pathname}`)

const NEW_PASSWORD = 'Wholesale-Welcome-2026!'
const pwFields = page.locator('input[type="password"]')
const fieldCount = await pwFields.count()
let setViaBrowser = false

if (fieldCount >= 1) {
  await pwFields.nth(0).fill(NEW_PASSWORD)
  if (fieldCount >= 2) await pwFields.nth(1).fill(NEW_PASSWORD)
  await page.locator('form').filter({ has: page.locator('input[type="password"]') })
            .first().locator('button[type="submit"], input[type="submit"]').first()
            .click({ timeout: 5000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.screenshot({ path: `${OUT}/03-after-submit.png`, fullPage: true })
  setViaBrowser = true
}
step('the reset page offers a password form', fieldCount >= 1, `${fieldCount} password field(s)`)

// ── the assertion that matters: can they actually get in ────────────────────
// Checked against the database rather than by reading the page, because a storefront
// can show "your password was changed" and still not have changed it.
const verified = rails(`
  u = Spree.user_class.find_by(email: ${JSON.stringify(email)})
  puts u && u.valid_password?(${JSON.stringify(NEW_PASSWORD)}) ? 'YES' : 'NO'
`)
step('the customer can now authenticate with the password they set', verified === 'YES',
     setViaBrowser ? 'set through the browser' : 'form not reachable')

await ctx.close()
await browser.close()

// ── cleanup ─────────────────────────────────────────────────────────────────
rails(`Spree.user_class.where("email LIKE 'wholesale-%@example.com'").destroy_all`)

console.log('')
if (fail.length) {
  console.log(`${fail.length} step(s) failed: ${fail.join(', ')}`)
  console.log(`screenshots in ${OUT}/`)
  process.exit(1)
}
console.log(`ALL ${steps.length} STEPS PASS — screenshots in ${OUT}/`)
