#!/usr/bin/env node
// Does the card entry form actually paint?
//
// 20 Sep: five shops, five separate Stripe accounts, all stopped taking money
// within days of each other. Stripe holds dozens of payment intents stuck at
// requires_payment_method and almost no card errors at all, which means cards
// are not being declined, they are never being submitted. The server side is
// green end to end: address saved, postage quoted, intent created, session
// pending.
//
// The one thing nothing had looked at is whether the customer is given a box
// to type a card into. Spree renders Stripe's payment element inside an
// iframe. If that element never mounts, the page shows a tall grey blank, the
// Pay Now button stays enabled, and there is no error anywhere: not in the
// browser, not in the logs, not in Stripe.
//
// So this walks to the payment step and asks one question, several times per
// shop, because an intermittent fault is the only kind that lets some orders
// through: is the card number input visible and can it take a digit?
//
// Nothing is submitted. No card reaches Stripe.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = (f) => readFileSync(join(ROOT, f), "utf8").split("\n")
  .filter(l => l.trim() && !l.startsWith("#")).map(l => l.split("|").map(s => s.trim()));

const dash = (v) => (v === "-" || !v ? undefined : v);
const ADDR = {};
for (const [shop, opensOn, pick, city, state, postal, phone] of rows(".checkout_probes")) {
  ADDR[shop] = { country: dash(pick) ?? dash(opensOn), city, state: dash(state), postal, phone };
}
const SHOPS = {};
for (const r of rows(".estate")) SHOPS[r[0]] = { url: r[7] };

const args = process.argv.slice(2);
const runs = Number(args.find(a => /^\d+$/.test(a)) || 3);
const only = args.filter(a => !/^\d+$/.test(a));
const codes = (only.length ? only : Object.keys(ADDR)).filter(c => SHOPS[c]);

const OUT = join(ROOT, "tmp/urgent/card-field");
mkdirSync(OUT, { recursive: true });

// Typing with real key events, not fill(): these inputs carry no name
// attribute and the form only commits an address when the field is left.
// fill() sets the value, the page never notices, and the shipping section
// keeps saying "enter your shipping address" -- which looks exactly like a
// broken shop and is only a broken probe.
async function typeInto(page, sel, value) {
  const l = page.locator(sel).first();
  if (!(await l.count())) throw new Error(`no ${sel}`);
  await l.click();
  await page.keyboard.type(value, { delay: 40 });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(350);
}

async function oneRun(code, n) {
  const shop = SHOPS[code], a = ADDR[code];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errs = [];
  page.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });

  const out = { code, n, reached: false, cardVisible: false, accepts: false, payEnabled: null, errs: [], note: "" };
  try {
    await page.goto(`${shop.url}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const href = await page.locator('a[href*="/products/"]').first().getAttribute("href");
    await page.goto(new URL(href, shop.url).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('button:has-text("Add to")').first().click();
    await page.waitForTimeout(2500);
    await page.locator('a[href*="/checkout/"], button:has-text("Checkout")').first().click().catch(() => {});
    await page.waitForTimeout(3000);
    if (!/\/checkout\//.test(page.url())) {
      await page.locator('a[href*="/cart"]').first().click().catch(() => {});
      await page.waitForTimeout(2200);
      await page.locator('a[href*="/checkout/"], button:has-text("Checkout")').first().click().catch(() => {});
      await page.waitForTimeout(3000);
    }
    if (!/\/checkout\//.test(page.url())) { out.note = "never reached checkout"; throw new Error(out.note); }

    await typeInto(page, "#email", "probe@example.test");
    if (a.country) await page.locator("#ship-country").first().selectOption({ label: a.country }).catch(() => {});
    await page.waitForTimeout(600);
    await typeInto(page, "#ship-first_name", "Probe");
    await typeInto(page, "#ship-last_name", "Tester");
    await typeInto(page, "#ship-address1", "12 Test Street");
    await typeInto(page, "#ship-city", a.city);
    if (a.state) {
      const st = page.locator("#ship-state").first();
      if (await st.count()) await st.selectOption({ label: a.state }).catch(async () => { await st.selectOption(a.state).catch(() => {}); });
    }
    await page.waitForTimeout(600);
    await typeInto(page, "#ship-postal_code", a.postal);
    await typeInto(page, "#ship-phone", a.phone);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(9000);
    out.reached = /Standard Postage|\$/.test(await page.evaluate(() => {
      const m = document.body.innerText.match(/Shipping Method([\s\S]{0,120})/i); return m ? m[1] : "";
    }));

    // SCROLL FIRST. The card field is only asked for once the payment box
    // enters the window (useReachedPaymentStep), so a probe that stays at the
    // top of the page reports every working shop as one that never draws a
    // card. That is stated in the commit that added the gate, and this probe
    // reproduced it before the scroll was put back.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("h2,h3,div")]
        .find((n) => /payment method/i.test(n.textContent || "") && n.children.length < 40);
      (el ?? document.body).scrollIntoView({ block: "center" });
      window.scrollBy(0, 200);
    });
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(2500);

    // Wait generously. A customer would.
    const num = page.frameLocator("iframe[title*='payment'], iframe[name*='__privateStripeFrame']")
      .locator("input[name='number'], input#Field-numberInput").first();
    try {
      await num.waitFor({ state: "visible", timeout: 30000 });
      out.cardVisible = true;
      await num.fill("4242424242424242", { timeout: 8000 });
      out.accepts = ((await num.inputValue().catch(() => "")) || "").replace(/\D/g, "").length === 16;
    } catch (_) { /* recorded as not visible */ }

    const pay = page.getByRole("button", { name: /pay now|place order/i }).first();
    out.payEnabled = (await pay.count()) ? await pay.isEnabled() : null;

    if (!out.cardVisible) {
      await page.screenshot({ path: `${OUT}/${code}-${n}-blank.png`, fullPage: true });
      out.note = `shot ${code}-${n}-blank.png`;
    }
  } catch (e) {
    if (!out.note) out.note = String(e.message).slice(0, 70);
  }
  out.errs = [...new Set(errs)].slice(0, 3);
  await ctx.close(); await browser.close();
  return out;
}

console.log(`\nDoes the card field paint?  ${codes.length} shops x ${runs} runs\n`);
console.log("shop      run  postage  card box   takes digits  Pay Now");
const tally = {};
for (const code of codes) {
  tally[code] = { ok: 0, blank: 0 };
  for (let n = 1; n <= runs; n++) {
    const r = await oneRun(code, n);
    r.cardVisible ? tally[code].ok++ : tally[code].blank++;
    console.log(
      `${code.padEnd(9)} ${String(n).padEnd(4)} ${(r.reached ? "quoted" : "-").padEnd(8)} ` +
      `${(r.cardVisible ? "PAINTED" : "BLANK").padEnd(10)} ${String(r.accepts).padEnd(13)} ${String(r.payEnabled)}` +
      (r.note ? `   ${r.note}` : ""),
    );
    for (const e of r.errs) console.log(`             ! ${e}`);
  }
}
console.log("\n--- how often the customer gets no card box");
let blank = 0, total = 0;
for (const [c, t] of Object.entries(tally)) {
  blank += t.blank; total += t.ok + t.blank;
  console.log(`  ${c.padEnd(9)} blank ${t.blank}/${t.ok + t.blank}`);
}
console.log(`  ${"ALL".padEnd(9)} blank ${blank}/${total}`);
console.log(`\nblank screenshots in ${OUT}`);
