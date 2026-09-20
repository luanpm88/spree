#!/usr/bin/env node
// Does the card field actually accept a card and submit?
//
// Stripe shows 25 PaymentIntents since 16 Sep, every one stuck at
// requires_payment_method with no last_payment_error. That is not cards being
// declined -- it is no card ever reaching Stripe. This types one in.
//
// The number used is Stripe's own "always declined" test card. On a live key
// it cannot charge anything and cannot create an order; the decline IS the
// result, because a decline proves the form submitted.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = f => readFileSync(join(ROOT, f), "utf8").split("\n")
  .filter(l => l.trim() && !l.startsWith("#")).map(l => l.split("|").map(s => s.trim()));
const dash = v => (v === "-" || !v ? undefined : v);
const A = {}; for (const [s,o,p,c,st,po,ph] of rows("config/checkout_probe_addresses"))
  A[s] = { country: dash(p) ?? dash(o), city: c, state: dash(st), postal: po, phone: ph };
const S = {}; for (const r of rows(".estate")) S[r[0]] = { url: r[7] };

const code = process.argv[2] || "au";
const shop = S[code], a = A[code];
const OUT = join(ROOT, `tmp/urgent/${code}-card`); mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const net = [];
page.on("console", m => { if (m.type() === "error") net.push(`CONSOLE ${m.text().slice(0,140)}`); });
page.on("pageerror", e => net.push(`PAGEERROR ${String(e.message).slice(0,140)}`));
page.on("request", r => { if (/stripe\.com/.test(r.url())) net.push(`REQ ${r.method()} ${r.url().split("?")[0].slice(-60)}`); });
page.on("response", r => { if (/stripe\.com\/v1\/payment_intents/.test(r.url())) net.push(`RES ${r.status()} ${r.url().split("?")[0].slice(-60)}`); });
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
const fill = async (s,v) => { const l = page.locator(s).first(); if (await l.count()) await l.fill(v).catch(()=>{}); };

try {
  await page.goto(`${shop.url}/products`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const href = await page.locator('a[href*="/products/"]').first().getAttribute("href");
  await page.goto(new URL(href, shop.url).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /add to (cart|bag)/i }).first().click();
  await page.waitForTimeout(4000);
  await page.goto(`${shop.url}/cart`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("link", { name: /checkout/i }).first().click();
  await page.waitForTimeout(8000);

  const sel = page.locator("#ship-country").first();
  if (await sel.count()) await sel.selectOption({ label: a.country }).catch(()=>{});
  await page.waitForTimeout(1200);
  await fill("#email", "probe@example.test");
  await fill("#ship-first_name", "Probe"); await fill("#ship-last_name", "Test");
  await fill("#ship-address1", "1 Queen Street"); await fill("#ship-city", a.city);
  const st = page.locator("#ship-state");
  if (await st.count() && a.state) await st.first().selectOption({ label: a.state }).catch(()=>{});
  await fill("#ship-postal_code", a.postal); await fill("#ship-phone", a.phone);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(16000);
  await shot("01-ready-to-pay");

  // The card fields live in Stripe iframes.
  const frames = page.frames().filter(f => /stripe/.test(f.url()));
  console.log(`stripe iframes on the page: ${frames.length}`);
  let typed = false;
  for (const f of frames) {
    const num = f.locator('input[name="number"], input[autocomplete="cc-number"]').first();
    if (await num.count().catch(()=>0)) {
      await num.fill("4000000000000002");                 // Stripe's always-declined card
      await f.locator('input[name="expiry"], input[autocomplete="cc-exp"]').first().fill("12/34").catch(()=>{});
      await f.locator('input[name="cvc"], input[autocomplete="cc-csc"]').first().fill("123").catch(()=>{});
      await f.locator('input[name="postalCode"], input[autocomplete="postal-code"]').first().fill(a.postal).catch(()=>{});
      typed = true; break;
    }
  }
  console.log(typed ? "card typed into the Stripe field" : "NO CARD FIELD FOUND -- nothing to type into");
  await shot("02-card-typed");

  if (typed) {
    // The policy consent. It is a Radix Checkbox, so it renders as
    // <button role="checkbox">, NOT <input type=checkbox> -- looking for an
    // input finds nothing and silently skips it.
    const box = page.locator('#policy-consent');
    const exists = await box.count();
    console.log(`policy-consent present: ${exists > 0}`);
    if (exists) {
      const before = await box.getAttribute("aria-checked").catch(() => null);
      const tag = await box.evaluate(e => e.tagName).catch(() => "?");
      await box.click({ timeout: 10000 }).catch(e => console.log("  click threw:", String(e.message).slice(0,60)));
      await page.waitForTimeout(1200);
      const after = await box.getAttribute("aria-checked").catch(() => null);
      console.log(`  tag=${tag}  aria-checked ${before} -> ${after}`);
      if (after !== "true") console.log("  *** THE CUSTOMER CANNOT TICK THIS BOX ***");
    }
    await shot("02b-terms-ticked");

    const pay = page.getByRole("button", { name: /pay now|place order|complete/i }).first();
    console.log(`Pay button present: ${await pay.count() > 0}`);
    if (await pay.count()) {
      await pay.click();
      await page.waitForTimeout(20000);
      await shot("03-after-pay");
      const t = (await page.locator("body").innerText()).replace(/\s+/g," ");
      const msg = (t.match(/(declin|card was|error|incorrect|failed|try again)[^.]{0,100}/i) || [""])[0];
      console.log("page says after paying:", msg || "(no message)");
      console.log("url now:", page.url().slice(0, 80));
    }
  }
} catch (e) {
  console.log("THREW:", String(e.message).split("\n")[0].slice(0,120));
  await shot("99-failure").catch(()=>{});
}
console.log("\nconsole + network:"); [...new Set(net)].filter(l=>/CONSOLE|PAGEERROR|payment_intents|confirm/.test(l)).slice(-10).forEach(l => console.log("  " + l));
console.log(`shots in tmp/urgent/${code}-card/`);
await b.close();
