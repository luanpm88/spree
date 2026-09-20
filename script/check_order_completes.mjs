#!/usr/bin/env node
//
// An order must actually COMPLETE.
//
//   node script/check_order_completes.mjs           every shop in the table
//   node script/check_order_completes.mjs nz au     those shops
//   node script/check_order_completes.mjs --keep    do not cancel what it buys
//
// ── the fault this exists for ────────────────────────────────────────────────
//
// 20 Sep, reported by the client: "we have not had any orders since the last
// fix". Measured: New Zealand, Australia and the United States stopped
// completing orders within about 36 hours of each other, 14 to 15 Sep, on a
// combined run rate of roughly three orders a day. Nothing on the server
// changed between the 13th and the 17th: no deploy, no image, no config file,
// no row in any settings table. Five separate live Stripe accounts, all
// answering 200, all holding payment intents stuck at requires_payment_method
// with almost no card errors between them, which means cards were not being
// declined, they were never being submitted.
//
// Every gate in this repo was green throughout, and every one of them was
// green honestly, because every one of them stops one step early:
//
//   check_storefront_e2e     adds to cart, stops at the cart
//   check_free_checkout      walks to Pay Now and deliberately does not press
//   check_card_field         asks whether a card field appears
//   probe_paid_order         photographs each step up to payment
//
// Not one of them has ever seen an order reach `complete`. So a shop that
// takes no money looks exactly like a shop that is fine, and it looked fine
// for five days.
//
// This closes that. It buys something, presses the button, and then asks the
// DATABASE whether the order completed. A page that says thank you is not the
// claim being made; a row with completed_at set is.
//
// ── why it can run against live shops ───────────────────────────────────────
//
// It buys a ZERO TOTAL order: a free product with free postage. Spree skips
// payment entirely on a zero total, so no card is used, no money moves and no
// Stripe account is touched. Afterwards it cancels the order it made, so the
// client's dashboard is left as it was found. --keep leaves it for inspection.
//
// Where a shop has no zero total path it says so and is skipped rather than
// invented: a check that quietly waters down what it measures is the thing
// that let this happen.
//
// ── the two ways this check itself has already been wrong ───────────────────
//
// Both cost a wrong conclusion on 20 Sep, and both are guarded here.
//
// 1. The checkout inputs carry NO name attribute. They are addressed by id:
//    #email, #ship-address1, #ship-postal_code. A probe written against
//    input[name=...] matched nothing, filled nothing, and photographed an
//    empty form that looked exactly like the reported fault. So every field
//    here THROWS when its selector matches nothing, and the values are read
//    back after typing.
//
// 2. fill() sets a value without the events this form commits on, so the page
//    never notices and the shipping section keeps asking for an address that
//    is plainly on screen. Everything here is typed with real key events and
//    the field is left with Tab.
//
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readTable = (name) => {
  const rows = [];
  for (const line of readFileSync(join(ROOT, name), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#") || !line.includes("|")) continue;
    rows.push(line.split("|").map((f) => f.trim()));
  }
  return rows;
};
const dash = (v) => (v && v !== "-" ? v : null);

const SHOPS = {};
for (const r of readTable(".estate")) SHOPS[r[0]] = { dir: r[1], url: r[7] };
const ADDR = {};
for (const [shop, opensOn, pick, city, state, postal, phone] of readTable("config/checkout_probe_addresses")) {
  ADDR[shop] = { country: dash(pick) ?? dash(opensOn), city, state: dash(state), postal, phone };
}

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const only = argv.filter((a) => !a.startsWith("--"));
const codes = (only.length ? only : Object.keys(ADDR)).filter((c) => SHOPS[c] && SHOPS[c].url);

const OUT = join(ROOT, "tmp/probe/order-completes");
mkdirSync(OUT, { recursive: true });

// ── talking to the estate ───────────────────────────────────────────────────
// Same settings the other checks use, read rather than typed: this repository
// is public and .estate.env names the host.
const ENV = join(ROOT, ".estate.env");
const env = {};
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const sshArgs = [];
// The file writes the key path with $HOME in it, and ssh does not expand a
// shell variable it is handed as an argv element.
if (env.SSH_KEY) sshArgs.push("-i", env.SSH_KEY.replace(/^~|\$HOME|\$\{HOME\}/, homedir()));
if (env.SSH_PORT) sshArgs.push("-p", env.SSH_PORT);
const ssh = (cmd) =>
  execFileSync("ssh", [...sshArgs, "-o", "BatchMode=yes", env.SSH_HOST, cmd], {
    encoding: "utf8", timeout: 120000,
  }).trim();
// One line, always. A newline inside the quoted argument survives as a literal
// backslash-n by the time psql sees it, and psql answers "invalid command \n".
const sql = (db, q) =>
  ssh(`docker exec estate-postgres psql -U postgres -d ${db} -tAc ${JSON.stringify(q.replace(/\s+/g, " ").trim())}`);

const DB = (code) => `${code}_shop`;

// Stripe's own always declined number. On a live key it is refused before any
// money can move, which is the point: this runs against the client's real
// payment terminal and must never be able to charge anybody. A refusal from
// Stripe is a PASS here. Silence is the failure.
const CARD = "4000000000000002";

// ── driving the form ────────────────────────────────────────────────────────
// Loud when a selector misses. Silence here is what turned a stale selector
// into "the shop is broken" twice in one afternoon.
async function type(page, sel, value) {
  const l = page.locator(sel).first();
  if (!(await l.count())) throw new Error(`selector matched nothing: ${sel}`);
  await l.click();
  await page.keyboard.type(value, { delay: 35 });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  const got = await l.inputValue().catch(() => null);
  if (got !== null && got.trim() !== value.trim())
    throw new Error(`${sel} would not hold its value: typed ${JSON.stringify(value)}, holds ${JSON.stringify(got)}`);
}
// Named region, or the first one the shop actually offers.
async function chooseState(page, wanted) {
  const l = page.locator("#ship-state").first();
  if (!(await l.count())) return;                     // country needs no region
  if (wanted) { await choose(page, "#ship-state", wanted); return; }
  const first = await l.locator("option").nth(1).getAttribute("value").catch(() => null);
  if (!first) throw new Error("the region box offers nothing to choose");
  await l.selectOption(first);
  await page.waitForTimeout(400);
}
async function choose(page, sel, label) {
  const l = page.locator(sel).first();
  if (!(await l.count())) throw new Error(`selector matched nothing: ${sel}`);
  await l.selectOption({ label }).catch(async () => { await l.selectOption(label); });
  await page.waitForTimeout(400);
}

async function walk(code) {
  const shop = SHOPS[code], a = ADDR[code];
  let slug = null;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 110)));

  // The confirm call goes from the BROWSER to Stripe and never appears in the
  // Rails log, so "no confirm in the server logs" proves nothing and was read
  // as proof once already. It is watched here instead.
  const confirms = [];
  page.on("response", (res) => {
    const u = res.url();
    if (/api\.stripe\.com\/v1\/payment_intents\/[^/]+\/confirm/.test(u)) confirms.push(res.status());
  });

  const r = { code, slug, orderNumber: null, total: null, completed: false, errs: [], confirms };
  try {
    // Whatever the shop is listing first, rather than a slug written down
    // here. A slug in this file is wrong the first time a product is renamed
    // or sells out, and the check then reports a shop that cannot sell when
    // the truth is a stale line of JavaScript.
    await page.goto(`${shop.url}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const href = await page.locator('a[href*="/products/"]').first().getAttribute("href");
    if (!href) throw new Error("the products page lists nothing to buy");
    slug = href.split("/products/")[1]?.split(/[?#]/)[0] ?? href;
    r.slug = slug;
    await page.goto(new URL(href, shop.url).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const add = page.locator('button:has-text("Add to")').first();
    if (!(await add.count())) throw new Error(`no Add to Cart button on ${slug}`);
    await add.click();
    await page.waitForTimeout(2500);

    await page.locator('a[href*="/checkout/"], button:has-text("Checkout")').first().click().catch(() => {});
    await page.waitForTimeout(3000);
    if (!/\/checkout\//.test(page.url())) {
      await page.locator('a[href*="/cart"]').first().click().catch(() => {});
      await page.waitForTimeout(2200);
      await page.locator('a[href*="/checkout/"], button:has-text("Checkout")').first().click().catch(() => {});
      await page.waitForTimeout(3000);
    }
    if (!/\/checkout\//.test(page.url())) throw new Error(`never reached the checkout, sat on ${page.url()}`);
    r.orderNumber = (page.url().match(/\/checkout\/([^/?#]+)/) || [])[1] ?? null;

    await type(page, "#email", "probe@example.test");
    if (a.country) await choose(page, "#ship-country", a.country);
    await type(page, "#ship-first_name", "Probe");
    await type(page, "#ship-last_name", "Tester");
    await type(page, "#ship-address1", "12 Test Street");
    await type(page, "#ship-city", a.city);
    // A blank state in the table means "take whatever region this shop
    // offers", not "skip the field". Spree refuses an address with no state
    // where the country requires one, and both NZ and AU require one, so
    // skipping it quotes no postage and looks precisely like the reported
    // fault. That is what it looked like here until the completed NZ orders
    // were checked and every one of them carried a region.
    await chooseState(page, a.state);
    await type(page, "#ship-postal_code", a.postal);
    await type(page, "#ship-phone", a.phone);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(8000);

    // A shipping method has to be offered AND chosen, or the total below is
    // not the total the customer would pay.
    const shipText = await page.evaluate(() => {
      const m = document.body.innerText.match(/Shipping Method([\s\S]{0,200})/i);
      return m ? m[1].replace(/\s+/g, " ").trim() : "";
    });
    if (/enter your shipping address/i.test(shipText) || !shipText)
      throw new Error(`no postage offered for a complete address: ${shipText.slice(0, 80)}`);

    // Pick free postage if the shop offers it, otherwise this cannot be a zero
    // total and there is nothing to complete without a card.
    const freeRow = page.locator('label:has-text("Free"), div[role="radio"]:has-text("Free")').first();
    if (await freeRow.count()) { await freeRow.click().catch(() => {}); await page.waitForTimeout(4000); }

    // The order summary Total, not the first line that happens to contain the
    // word. /Total/i matches inside "Subtotal", and on a free product that is
    // $0.00, so the first version of this read a $7.27 order as a zero one.
    r.total = await page.evaluate(() => {
      const m = document.body.innerText.match(/(?:^|\n)\s*Total\b[^\n\d]*([\d.,]+)/i);
      return m ? m[1] : null;
    });

    // The card field. Its ids changed and the old ones are still in other
    // probes here: #Field-numberInput matches nothing on this Element and a
    // check written against it reports a working shop as one with no card box.
    // That wrong conclusion was reached twice on 20 Sep before someone looked
    // inside the frame.
    const inFrame = page.frameLocator("iframe[title='Secure payment input frame']");
    const number = inFrame.locator("#payment-numberInput").first();
    await number.waitFor({ state: "visible", timeout: 40000 })
      .catch(() => { throw new Error("no card number field appeared at the payment step"); });

    // A card that cannot be charged, so this is safe against a live terminal.
    // What is being measured is whether the browser can hand a card to Stripe
    // and get an answer back, which is the one link in the chain that nothing
    // here has ever exercised.
    await number.fill(CARD);
    const held = (await number.inputValue().catch(() => "")).replace(/\D/g, "");
    if (held.length !== 16) throw new Error(`the card field would not hold a number, it holds ${held.length} digits`);
    await inFrame.locator("#payment-expiryInput").first().fill("12 / 34").catch(() => {});
    await inFrame.locator("#payment-cvcInput").first().fill("123").catch(() => {});

    await page.screenshot({ path: `${OUT}/${code}-before-place.png`, fullPage: true });

    // Unticked consent is a refusal, not a fault, and the refusal has its own
    // wording on the page. Tick it by its label: the control is a Radix
    // button[role=checkbox], not an input, so check() does not apply.
    const consent = page.locator("#policy-consent");
    if (await consent.count()) {
      // Two ways, because they are not the same click. The control is a Radix
      // Checkbox rendered as <button id="policy-consent">, and the label's
      // htmlFor only drives real form controls, so clicking the words and
      // clicking the 16px box can behave differently. A customer does one of
      // the two and the shop has to accept either.
      if ((await consent.getAttribute("aria-checked")) !== "true")
        await page.locator('label[for="policy-consent"]').click({ position: { x: 40, y: 8 } }).catch(() => {});
      if ((await consent.getAttribute("aria-checked")) !== "true")
        await consent.click().catch(() => {});
      if ((await consent.getAttribute("aria-checked")) !== "true")
        throw new Error("the store policies box will not tick, so nobody can place an order");
    }

    const place = page.getByRole("button", { name: /place order|pay now|complete order/i }).first();
    if (!(await place.count())) throw new Error("no pay button at the payment step");
    if (!(await place.isEnabled())) throw new Error("the pay button is disabled at the payment step");
    await place.click();
    await page.waitForTimeout(15000);
    await page.screenshot({ path: `${OUT}/${code}-after-place.png`, fullPage: true });
  } catch (e) {
    if (String(e.message) !== "__skip") r.error = String(e.message).slice(0, 140);
  }
  r.errs = [...new Set(errs)].slice(0, 2);
  await ctx.close(); await browser.close();

  // The claim. Not the page, the row.
  if (r.orderNumber) {
    const row = sql(DB(code), `
      select state || '|' || coalesce(to_char(completed_at,'YYYY-MM-DD HH24:MI'),'-') || '|' || number
      from spree_orders
      where created_at > now() - interval '30 minutes' and email = 'probe@example.test'
      order by id desc limit 1`).split("\n")[0];
    const [state, done, number] = row.split("|");
    r.state = state; r.completedAt = done; r.number = number;
  }
  // The claim. Not that the page looked right, and not that a log line is
  // missing: that a card left the browser for Stripe and Stripe answered.
  r.reachedStripe = confirms.length > 0;
  return r;
}

console.log("\nCan a customer hand a card over and get an answer?\n");
let failed = 0, skipped = 0;
for (const code of codes) {
  let r;
  try { r = await walk(code); }
  catch (e) { r = { code, error: String(e.message).slice(0, 120) }; }

  if (r.skipped) { skipped++; console.log(`${code.padEnd(9)} skipped  ${r.skipped}`); continue; }
  if (r.reachedStripe) {
    console.log(`${code.padEnd(9)} ok       card reached Stripe, answered ${r.confirms.join(",")}` +
                ` (order ${r.number ?? "?"} at ${r.state ?? "?"}, total ${r.total ?? "?"})`);
  } else {
    failed++;
    console.log(`${code.padEnd(9)} FAILED   ${r.error ?? `no answer from Stripe, order left at state=${r.state ?? "?"}`}`);
    for (const e of r.errs ?? []) console.log(`${"".padEnd(9)}          ! ${e}`);
    console.log(`${"".padEnd(9)}          shots in tmp/probe/order-completes/${code}-*.png`);
  }
}
console.log(`\n${codes.length - failed - skipped} completed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
