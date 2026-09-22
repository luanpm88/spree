// Prove the /admin/emails screen works, and prove that using it sends nothing.
//
//   node script/check_admin_emails.mjs http://localhost:3000 admin@example.com 'password'
//   MAILPIT=http://localhost:8025 node script/check_admin_emails.mjs ...
//
// ── the one assertion everything else rests on ──────────────────────────────
//
// This screen renders a real customer's order confirmation, built from the
// shop's own data. If a preview click could deliver, one click would post that
// order's confirmation to that customer a second time.
//
// The code is arranged so it cannot: Spree::EmailSamples never creates an
// ActionMailer::MessageDelivery (a Delegator, on which `.deliver` forwards to
// Mail::Message#deliver and SENDS), and sets perform_deliveries = false on the
// message it builds. script/check_admin_emails greps for that. This file is the
// other half: it counts the messages at the SMTP endpoint, drives every row on
// the screen, and counts again.
//
// Counting at Mailpit rather than at ActionMailer::Base.deliveries is
// deliberate. `deliveries` only fills under the :test delivery method, which is
// not what a server runs; Mailpit is the real SMTP endpoint this stack delivers
// to, so a message that escaped would land there. Where Mailpit is not
// reachable the check says so and does NOT claim the property.
//
// ── and it must not have broken the shop ───────────────────────────────────
//
// A new settings-sidebar entry is registered from config/initializers/spree.rb.
// Spree::Admin::Navigation#add is an unconditional overwrite, so the wrong key
// removes the store's real email settings link silently. The walk below opens
// that page too and asserts it is still there.
//
// Exits non-zero on any failure, and writes screenshots either way.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [BASE, EMAIL, PASS] = process.argv.slice(2)
if (!BASE || !EMAIL || !PASS) {
  console.error('usage: node script/check_admin_emails.mjs <base-url> <email> <password>')
  process.exit(1)
}

const MAILPIT = process.env.MAILPIT || 'http://localhost:8025'
const OUT = 'tmp/admin-emails'
mkdirSync(OUT, { recursive: true })

const mailCount = async () => {
  try {
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=1`)
    if (!r.ok) return null
    return (await r.json()).messages_count
  } catch {
    return null
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const problems = []
// Faults this screen REVEALS about the shop's own emails, as opposed to faults
// in the screen. Printed at the end and never fatal here — see step 3.
const findings = []
const netErrors = []
page.on('requestfailed', (r) => netErrors.push(`${r.failure()?.errorText} ${r.url()}`))
page.on('response', (r) => { if (r.status() >= 500) netErrors.push(`HTTP ${r.status()} ${r.url()}`) })
page.on('pageerror', (e) => netErrors.push(`JS ${e.message}`))

const fail = async (msg) => {
  console.error(`\nFAIL  ${msg}`)
  if (netErrors.length) console.error('network/js:\n  ' + [...new Set(netErrors)].slice(0, 8).join('\n  '))
  try { await page.screenshot({ path: `${OUT}/fail.png`, fullPage: true }) } catch {}
  await browser.close()
  process.exit(1)
}

// ── 0. the SMTP endpoint, before anything ──────────────────────────────────
const before = await mailCount()
console.log(`0. mailpit before: ${before === null ? 'UNREACHABLE' : before}`)
if (before === null) {
  console.log(`   ${MAILPIT} did not answer. The walk still runs, but the "nothing was sent"`)
  console.log('   assertion cannot be made and this check will exit non-zero.')
}

// ── 1. sign in ─────────────────────────────────────────────────────────────
console.log(`1. signing in at ${BASE}/admin`)
try {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 })
} catch (e) {
  await fail(`could not load the admin: ${e.message}`)
}
const emailField = page.locator('input[type="email"], input[name*="email" i]').first()
if (await emailField.count()) {
  await emailField.fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASS)
  await page.locator('button[type="submit"], input[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
}
if (/sign_in|login/.test(page.url())) await fail(`still on the sign-in page: ${page.url()}`)

// ── 2. the screen loads and lists emails ───────────────────────────────────
console.log('2. opening /admin/emails')
const resp = await page.goto(`${BASE}/admin/emails`, { waitUntil: 'networkidle', timeout: 45000 })
if (!resp || resp.status() !== 200) await fail(`/admin/emails answered ${resp && resp.status()}`)

// Positive assertion. An earlier check in this repo passed on a chrome-error://
// page because it only asserted the ABSENCE of a failure marker.
const rows = page.locator('[data-email-row]')
const rowCount = await rows.count()
console.log(`   ${rowCount} rows`)
if (rowCount < 20) await fail(`only ${rowCount} emails listed; this app has 26`)

// The header must appear once. The first draft of this screen printed its own
// <h1> under the one the admin layout had already drawn.
const titles = await page.locator('#page_title').allTextContents()
const h1s = await page.locator('.admin-emails h1, #content h1').count()
if (h1s > 0) problems.push(`the page draws ${h1s} <h1> of its own; the layout already draws the title`)
console.log(`   page title: ${titles.map((t) => t.trim()).join(' / ')}`)

// The screen's OWN strings. config/locales/* is gitignored in this repo and
// this screen's file had to be allowlisted by hand, so the failure mode is a
// deploy where every label on the page reads "translation missing". That IS a
// failure of this screen, unlike the same thing inside an email body.
const pageText = await page.locator('#email-editor').innerText()
if (/translation missing/i.test(pageText)) {
  problems.push(`the screen's own labels show a missing translation: ${pageText.match(/translation missing[^\n]*/i)[0]}`)
}

// Cache-Control, because the body names a customer and what they paid.
const cc = resp.headers()['cache-control'] || ''
if (!cc.includes('no-store')) problems.push(`Cache-Control is "${cc}", expected no-store`)

// ── 3. every row: select it, and the frame must render something ───────────
console.log('3. clicking every row')
const seen = []
for (let i = 0; i < rowCount; i++) {
  const row = rows.nth(i)
  const id = await row.getAttribute('data-email-row')
  const status = await row.getAttribute('data-email-status')
  await row.click()
  // The frame's own load event flips this class. Waiting on it rather than on a
  // timeout is what makes the walk a measurement instead of a guess.
  await page.waitForFunction(() => document.body.classList.contains('email-live'), null, { timeout: 20000 })
    .catch(() => problems.push(`${id}: the frame never finished loading`))

  const frame = page.frameLocator('#email-frame')
  const text = (await frame.locator('body').innerText().catch(() => '')) || ''
  if (!text.trim()) problems.push(`${id}: the frame rendered an empty document`)
  // A Rails error page inside the frame renders fine and answers 200.
  if (/Exception|NoMethodError|undefined method|ActionView::Template::Error/.test(text)) {
    problems.push(`${id}: the frame shows a Rails error: ${text.slice(0, 120)}`)
  }
  // A missing key does not raise — I18n prints it, into the html as a
  // translation_missing span and into the plain text part as the words
  // "translation missing: en-CA…" in the middle of a sentence to a customer.
  //
  // This is a FINDING about the shop's wording, not a failure of this screen,
  // so it is reported rather than failed on: `bin/rails emails:smoke` is the
  // gate for what is inside an email, and it checks for this too since 22 Sep.
  // Failing here would make a check about the admin UI go red over a locale
  // file, and the next person would learn to ignore it.
  const keys = [...new Set([...text.matchAll(/translation missing: ([^"\n]+)/g)].map((m) => m[1].trim()))]
  if (keys.length) findings.push(`${id}: ${keys.length} missing translation(s) — ${keys.slice(0, 4).join(', ')}`)
  seen.push({ id, status, chars: text.trim().length })
}
console.log(
  '   ' +
    Object.entries(
      seen.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {})
    )
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
)

// At least one row must be a real email with a real body, or the screen is
// green while showing nothing but notices.
const substantial = seen.filter((r) => r.status === 'ready' && r.chars > 200)
if (!substantial.length) await fail('no row produced a real email body; the screen proves nothing')
console.log(`   ${substantial.length} rows rendered a real body`)

// ── 4. the envelope, the text toggle, the phone, the full screen ───────────
console.log('4. the controls')
const ready = page.locator('[data-email-status="ready"]').first()
await ready.click()
await page.waitForFunction(() => document.body.classList.contains('email-live'), null, { timeout: 20000 })
await page.waitForSelector('#email-head:not([hidden])', { timeout: 20000 })
  .catch(() => problems.push('the subject bar never appeared'))
const subject = (await page.locator('#email-subject').innerText().catch(() => '')).trim()
console.log(`   subject: ${subject || '(none)'}`)
if (!subject) problems.push('the envelope returned no subject')

await page.screenshot({ path: `${OUT}/01-desktop.png` })

const textBtn = page.locator('[data-email-part="text"]')
if (!(await textBtn.isDisabled())) {
  await textBtn.click()
  await page.waitForFunction(() => document.body.classList.contains('email-live'), null, { timeout: 20000 })
  const t = await page.frameLocator('#email-frame').locator('pre').innerText().catch(() => '')
  if (!t.trim()) problems.push('the plain text part rendered empty')
  else console.log(`   plain text: ${t.trim().length} chars`)
  await page.screenshot({ path: `${OUT}/02-text.png` })
  await page.locator('[data-email-part="html"]').click()
  await page.waitForFunction(() => document.body.classList.contains('email-live'), null, { timeout: 20000 })
}

await page.locator('[data-email-device="mobile"]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/03-phone.png` })
const narrow = await page.locator('#email-frame').evaluate((el) => el.style.width)
if (narrow !== '420px') problems.push(`the phone toggle set the frame to ${narrow}, expected 420px`)
await page.locator('[data-email-device="desktop"]').click()
await page.waitForTimeout(300)

await page.locator('#email-expand').click()
await page.waitForTimeout(400)
if (!(await page.evaluate(() => document.body.classList.contains('email-full')))) {
  problems.push('full screen did not engage')
}
await page.screenshot({ path: `${OUT}/04-full.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
if (await page.evaluate(() => document.body.classList.contains('email-full'))) {
  problems.push('Escape did not leave full screen')
}

// ── 4b. proof shots of the two rows that matter most ───────────────────────
//
// The order confirmation is the email a customer actually gets and the one the
// client asks about; a "no data yet" row is the state this screen exists to
// tell apart from a fault. Both are worth a picture, because a list of ticks
// is an assertion and a screenshot is evidence.
const shotOf = async (selector, name) => {
  const row = page.locator(selector).first()
  if (!(await row.count())) return
  await row.click()
  await page
    .waitForFunction(() => document.body.classList.contains('email-live'), null, { timeout: 20000 })
    .catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}
await shotOf('[data-email-row$="order_mailer~confirm_email"]', '06-order-confirmation')
await shotOf('[data-email-status="no_record"]', '07-no-data-yet')
await shotOf('[data-email-status="never"]', '08-never-sent')

// ── 5. the iframe must be sandboxed ────────────────────────────────────────
//
// This app has no CSP and these bodies include templates ported off a live
// site. Without the sandbox, script in one of them runs with the admin session.
const sandbox = await page.locator('#email-frame').getAttribute('sandbox')
if (sandbox === null) problems.push('the preview iframe is NOT sandboxed')
else console.log(`5. iframe sandbox="${sandbox}" (empty means every restriction on)`)

// ── 6. nothing on the shop broke ───────────────────────────────────────────
console.log('6. the store email settings page is still reachable')
const settings = await page.goto(`${BASE}/admin/store/edit?section=emails`, {
  waitUntil: 'domcontentloaded',
  timeout: 45000
})
if (!settings || settings.status() >= 400) {
  problems.push(`the store email settings page answered ${settings && settings.status()} — the nav key may have overwritten it`)
} else {
  // Both items must be in the settings sidebar: the store's own Emails page,
  // which registers under the key :emails, and this screen, which must NOT.
  // Navigation#add is `@items[key] = item` with no warning on collision.
  const settingsLink = await page.locator('a[href*="section=emails"]').count()
  const templatesLink = await page.locator('a[href$="/admin/emails"]').count()
  if (settingsLink === 0) problems.push('the store\'s own "Emails" settings link is gone from the sidebar')
  if (templatesLink === 0) problems.push('the new email templates link is not in the settings sidebar')
  console.log(`   store email settings: ${settingsLink} link(s); this screen: ${templatesLink} link(s)`)
  await page.screenshot({ path: `${OUT}/05-settings-nav.png` })
}

// ── 7. the assertion ───────────────────────────────────────────────────────
const after = await mailCount()
console.log(`\n7. mailpit after: ${after === null ? 'UNREACHABLE' : after}`)
if (before === null || after === null) {
  problems.push(`could not reach ${MAILPIT}, so "nothing was sent" was NOT proven`)
} else if (after !== before) {
  problems.push(`*** ${after - before} message(s) were SENT by browsing the preview screen ***`)
} else {
  console.log(`   unchanged at ${after} after ${rowCount} previews. Nothing was sent.`)
}

if (netErrors.length) {
  const real = [...new Set(netErrors)].filter((e) => !/favicon/.test(e))
  if (real.length) problems.push(`network/js errors:\n     ${real.slice(0, 6).join('\n     ')}`)
}

await browser.close()

if (findings.length) {
  console.log(`\nFINDINGS  ${findings.length} thing(s) this screen found wrong with the shop's emails.`)
  console.log('          These are not failures of the screen. Fix them, then re-run:')
  console.log('            bin/rails emails:smoke')
  findings.forEach((f) => console.log(`  - ${f}`))
}

if (problems.length) {
  console.error(`\nFAIL  ${problems.length} problem(s):`)
  problems.forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}
console.log(`\nPASS  ${rowCount} emails listed, ${substantial.length} rendered, nothing sent.`)
console.log(`      screenshots in ${OUT}/`)
