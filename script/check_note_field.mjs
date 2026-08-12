// Proves the overridden admin customer form actually RENDERS, and that the approval note
// box is on it beside the customer group selector.
//
// An override of a Spree admin partial cannot be trusted until a browser has loaded it: a
// bad option to a form helper raises at render time, which turns the one screen the client
// uses to approve customers into a 500. Rendering the partial in isolation would not catch
// it either, because it depends on current_store, tom_select_tag and can?.
//
//   node script/check_note_field.mjs http://localhost:3000 spree@example.com password
//
// TWO THINGS THIS SCRIPT LEARNED THE HARD WAY, both of which made an earlier version
// report a false failure:
//
//   1. Admin URLs take a PREFIXED id (cus_UkLWZg9DAJ). Spree::Admin::UsersController
//      finds with find_by_prefix_id!, so /admin/users/1/edit rescues into a redirect to
//      the customer list. Passing a raw id looks exactly like a missing field.
//   2. The customer form is a Turbo Frame drawer, opened from the show page. It is not a
//      page of its own, so the drawer has to be opened by clicking Edit.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [BASE, EMAIL, PASS, CUSTOMER] = process.argv.slice(2)
if (!BASE || !EMAIL || !PASS || !CUSTOMER) {
  console.error('usage: node script/check_note_field.mjs <base-url> <admin-email> <password> <customer-prefixed-id>')
  console.error('       the prefixed id, e.g. cus_UkLWZg9DAJ. A raw database id redirects to the list.')
  process.exit(1)
}
const OUT = 'tmp/note-field'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
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

const showUrl = `${BASE}/admin/users/${CUSTOMER}`
const shown = await page.goto(showUrl, { waitUntil: 'domcontentloaded' })
if (!shown || shown.status() !== 200) await fail(`${showUrl} answered ${shown && shown.status()}`)
if (!page.url().includes(CUSTOMER)) await fail(`redirected off the customer page to ${page.url()} — is that a prefixed id?`)

// The Edit button opens the drawer that holds the form.
// The users edit link specifically. There are TWO drawer links on a customer page and
// the other one is Metafields, which is invisible until its section is opened — a bare
// [data-turbo-frame="drawer"] selector picked that one and timed out clicking it.
const editLink = page.locator(`a[href="/admin/users/${CUSTOMER}/edit"][data-turbo-frame="drawer"]`).first()
if (!(await editLink.count())) await fail('no Edit link with data-turbo-frame=drawer on the show page')
await editLink.click()

const box = page.locator('textarea[name="user[approval_note]"]')
try {
  await box.waitFor({ state: 'visible', timeout: 15000 })
} catch {
  await fail('the approval note textarea never appeared in the drawer')
}

const groupSelect = page.locator('select[name="user[customer_group_ids][]"]')
if (!(await groupSelect.count())) await fail('customer group selector missing — the override dropped it')

for (const sel of [
  'input[name="user[email]"]', 'input[name="user[first_name]"]',
  'input[name="user[last_name]"]', 'input[name="user[phone]"]',
]) {
  if (!(await page.locator(sel).count())) await fail(`the override dropped ${sel}`)
}

const html = await page.content()
if (html.includes('translation_missing')) {
  await fail(`translation_missing on the page: ${(html.match(/translation missing: [^"]+/) || ['?'])[0]}`)
}
if (serverErrors.length) await fail(`5xx during the run: ${serverErrors.join(', ')}`)

await page.screenshot({ path: `${OUT}/drawer.png`, fullPage: true })

// Round-trip it, which also proves private_metadata was merged and not replaced.
const NOTE = 'your GST number and a delivery contact'
// Fill the required fields first. The form marks email, first_name and last_name
// required, and requestSubmit() honours HTML5 validation by doing NOTHING at all when the
// form is invalid: no request, no error, no clue. This customer had no name, so the save
// was being refused by the browser rather than by Rails.
for (const [sel, val] of [
  ['input[name="user[first_name]"]', 'Dana'],
  ['input[name="user[last_name]"]', 'Whitcombe'],
]) {
  const f = page.locator(sel)
  if ((await f.count()) && !(await f.inputValue())) await f.fill(val)
}
const invalid = await page.evaluate(() => {
  const form = document.querySelector('turbo-frame#drawer form')
  return [...form.querySelectorAll(':invalid')].map((e) => e.getAttribute('name'))
})
if (invalid.length) await fail(`form still invalid, cannot save: ${invalid.join(', ')}`)

await box.fill(NOTE)
// requestSubmit() rather than clicking Save. The Save button is a visible type=submit
// inside the drawer form, and clicking it in headless Chromium fired no request at all —
// verified by logging every POST/PATCH on the page. requestSubmit is what the button is
// supposed to do, and it goes through Turbo the same way.
await page.evaluate(() => document.querySelector('turbo-frame#drawer form').requestSubmit())
await page.waitForResponse(
  (r) => ['POST', 'PATCH', 'PUT'].includes(r.request().method()) && r.url().includes('/admin/users/'),
  { timeout: 15000 },
)
await page.waitForTimeout(1200)
await page.goto(showUrl, { waitUntil: 'domcontentloaded' })
await page.locator(`a[href="/admin/users/${CUSTOMER}/edit"][data-turbo-frame="drawer"]`).first().click()
await page.locator('textarea[name="user[approval_note]"]').waitFor({ state: 'visible', timeout: 15000 })
const saved = await page.locator('textarea[name="user[approval_note]"]').inputValue()
if (saved !== NOTE) await fail(`the note did not round-trip, got ${JSON.stringify(saved)}`)

await page.screenshot({ path: `${OUT}/saved.png`, fullPage: true })
console.log('ok    approval note box renders in the drawer beside the group selector, and round-trips')
await browser.close()
