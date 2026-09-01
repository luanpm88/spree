// Render Spree's transactional emails against a REAL order and screenshot them, so a
// template can be compared against the design it was drawn from.
//
//   node script/render_emails.mjs                 # every template below
//   node script/render_emails.mjs confirm_email   # just one
//
// Output: tmp/emails/<name>.html and <name>.png (+ -mobile.png), gitignored.
//
// Why not just trust that it rendered: an email template fails in ways that still
// produce a 200 and a plausible-looking file.
//
//   - A missing i18n key renders as EMPTY, not as an error. The layout survives, the
//     words vanish. The shop's templates use four custom scopes, so this is the most
//     likely failure and the least visible one.
//   - A view override that keeps its own <!DOCTYPE> while the mailer layout supplies
//     another produces nested <html>. Clients strip the inner document and the design
//     disappears.
//   - Remote images are the norm in email and silently 404.
//
// Each of those is checked explicitly below rather than left to the eye.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'

const OUT = 'tmp/emails'
const COMPOSE = ['compose', '-f', 'docker-compose.dev.yml', 'exec', '-T', 'web']

// ── running against a real shop on the server ────────────────────────────────
//
//   SHOP=ca node script/render_emails.mjs
//
// The local dev container renders the templates against a synthetic order. That
// answers "does the template work", which is not the question the client asked:
// he wants to see what HIS canada shop sends, with his wording, his logo and one
// of his own orders in it. Those differ per shop, because the copy lives in the
// locale file and the logo is a store attachment.
//
// So SHOP=<name> execs into that shop's container on the estate box instead, and
// ORDER=<number> picks which order to render. Default is the newest completed
// one, because an incomplete order has no shipment and half the templates read
// one.
const SHOP = process.env.SHOP || ''
const ORDER = process.env.ORDER || ''
let EXEC = ['docker', [...COMPOSE]]
if (SHOP) {
  const env = existsSync('.estate.env') ? readFileSync('.estate.env', 'utf8') : ''
  const get = (k) => (env.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) || [])[1] || ''
  const key = get('SSH_KEY').replace('$HOME', process.env.HOME)
  const host = get('SSH_HOST'), port = get('SSH_PORT')
  if (!host) { console.error('error  SHOP is set but .estate.env has no SSH_HOST'); process.exit(1) }
  EXEC = ['ssh', ['-i', key, '-p', port, '-o', 'BatchMode=yes', host, `docker exec -i ${SHOP}_web`]]
}

// name -> the mailer call that builds it. Add a row as each design is ported.
const TEMPLATES = {
  confirm_email: 'Spree::OrderMailer.confirm_email(order)',
  cancel_email: 'Spree::OrderMailer.cancel_email(order)',
  store_owner_notification_email: 'Spree::OrderMailer.store_owner_notification_email(order)',
  // payment_link_email takes an id and only accepts an INCOMPLETE order, so it cannot
  // use the completed preview order the others share.
  // Its own fixture: payment_link_email refuses a completed order by design.
  payment_link_email: "Spree::OrderMailer.payment_link_email(Spree::Order.find_by!(number: 'R-EMAIL-CART').id)",
  shipped_email: 'Spree::ShipmentMailer.shipped_email(order.shipments.first)',
  reimbursement_email: 'Spree::ReimbursementMailer.reimbursement_email(Spree::Reimbursement.order(:id).last)',
}

const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(TEMPLATES)
for (const n of wanted) if (!TEMPLATES[n]) { console.error(`unknown template: ${n}`); process.exit(1) }

mkdirSync(OUT, { recursive: true })

// Use the dedicated preview order (bin/rails email:preview_order). The seeded orders
// are unsuitable: both have a single line item, so the product loop is never really
// exercised, and one of the two has no ship_address, which crashes any template that
// reads it without a nil guard.
const RUBY = `
order = ${ORDER ? `Spree::Order.find_by(number: '${ORDER}')` : "Spree::Order.find_by(number: 'R-EMAIL-PREVIEW')"}
${SHOP ? `order ||= Spree::Order.complete.order(:completed_at).last
order ||= Spree::Order.order(:id).last` : ''}
if order.nil?
  raise "no order to render against${SHOP ? '' : " — run: docker compose -f docker-compose.dev.yml exec web bin/rails email:preview_order"}"
end
$stderr.puts "order=#{order.number} items=#{order.line_items.size} total=#{order.total} ship_address=#{!order.ship_address.nil?}"
${wanted.map((n) => `
begin
  mail = ${TEMPLATES[n]}
  body = mail.html_part&.body&.to_s || mail.body.to_s
  puts "===BEGIN ${n}==="
  puts body
  puts "===END ${n}==="
rescue => e
  puts "===BEGIN ${n}==="
  puts "RENDER_FAILED: #{e.class}: #{e.message}"
  puts "===END ${n}==="
end`).join('\n')}
`

console.log(SHOP ? `rendering inside ${SHOP}_web on the server…` : 'rendering in the web container…')
// The script goes in on STDIN, via `runner -`, not as an argument. Over ssh the
// whole remote command is one string, so a multi-line argument gets flattened
// and the ruby breaks apart into nonsense. stdin is immune to that and works the
// same locally.
const raw = execFileSync(EXEC[0], [...EXEC[1], 'bin/rails', 'runner', '-'], {
  encoding: 'utf8',
  input: RUBY,
  maxBuffer: 40 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'inherit'],
})

const problems = []
const browser = await chromium.launch()
const results = []

for (const name of wanted) {
  const m = raw.match(new RegExp(`===BEGIN ${name}===\\n([\\s\\S]*?)\\n===END ${name}===`))
  if (!m) { problems.push(`${name}: no output from the renderer`); continue }
  const html = m[1]

  if (html.startsWith('RENDER_FAILED')) { problems.push(`${name}: ${html}`); continue }

  // ── structural checks ────────────────────────────────────────────────────
  const htmlTags = (html.match(/<html[\s>]/gi) || []).length
  if (htmlTags !== 1) problems.push(`${name}: ${htmlTags} <html> elements, expected exactly 1 (layout nesting)`)

  const missing = html.match(/translation missing: [^<"\s]+/g) || []
  for (const k of new Set(missing)) problems.push(`${name}: ${k}`)

  // An i18n string whose interpolation argument was never passed keeps the raw
  // %{placeholder} and renders it to the customer. Nothing errors, the layout is
  // perfect, and the email says "Hey %{name},". This slipped through a whole review
  // and into a PDF prepared for the client, because the eye reads it as a variable
  // rather than as text on the page.
  const unsubstituted = html.match(/%\{[a-z_]+\}/gi) || []
  for (const k of new Set(unsubstituted)) problems.push(`${name}: unsubstituted ${k} — the Spree.t call is missing that argument`)

  const file = `${OUT}/${name}.html`
  writeFileSync(file, html)

  // ── visual ───────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()

  const failedImages = []
  page.on('response', (r) => {
    if (r.request().resourceType() === 'image' && !r.ok()) failedImages.push(`${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => {
    if (r.resourceType() === 'image') failedImages.push(`unreachable ${r.url()}`)
  })

  await page.setContent(html, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })

  const text = await page.locator('body').innerText()
  await ctx.close()

  const ctxM = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const pm = await ctxM.newPage()
  await pm.setContent(html, { waitUntil: 'networkidle' })
  await pm.screenshot({ path: `${OUT}/${name}-mobile.png`, fullPage: true })
  const overflow = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  await ctxM.close()

  for (const f of new Set(failedImages)) problems.push(`${name}: image ${f}`)
  // Horizontal overflow at 390px is NOT a fault for email. These are fixed-width
  // table layouts, around 680px by design, and every mail client scales them to fit.
  // Reported for information only; failing on it flagged working templates.
  if (overflow) console.log(`  note ${name}: fixed-width layout, wider than a 390px viewport (normal for email)`)

  results.push({ name, bytes: html.length, words: text.split(/\s+/).filter(Boolean).length, overflow })
}

await browser.close()

console.log('')
for (const r of results) {
  console.log(`  ${r.name.padEnd(32)} ${String(r.bytes).padStart(7)} bytes  ${String(r.words).padStart(4)} words`)
}
console.log('')
if (problems.length) {
  console.log(`${problems.length} problem(s):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log(`ok — ${results.length} template(s), no missing copy, no layout nesting, no broken images`)
console.log(`screenshots in ${OUT}/`)
