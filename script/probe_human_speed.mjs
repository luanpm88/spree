#!/usr/bin/env node
// Why does a probe buy successfully while customers cannot?
//
// Every earlier probe filled the card in milliseconds. A person takes twenty
// to thirty seconds to read a card off the table and type sixteen digits. If
// the checkout page resets while they type, a fast probe never notices and a
// customer never gets to press Pay.
//
// So this walks to the payment step, then does two things no probe here has
// done: it sits still and counts what the page does on its own, and it types
// the card at human speed and reads the digits back.
//
// It submits nothing. No card is sent to Stripe.
//
// Selectors: the checkout inputs carry NO name attribute, only ids
// (#email, #ship-address1, ...). An earlier version of this file used
// input[name=...], matched nothing, filled nothing, and photographed an empty
// form that looked exactly like the fault being investigated.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = (f) => readFileSync(join(ROOT, f), "utf8").split("\n")
  .filter(l => l.trim() && !l.startsWith("#")).map(l => l.split("|").map(s => s.trim()));

const dash = (v) => (v === "-" || !v ? undefined : v);
const ADDR = {};
for (const [shop, opensOn, pick, city, state, postal, phone] of rows("config/checkout_probe_addresses")) {
  ADDR[shop] = { country: dash(pick) ?? dash(opensOn), city, state: dash(state), postal, phone };
}
const SHOPS = {};
for (const r of rows(".estate")) SHOPS[r[0]] = { url: r[7] };

const code = process.argv[2] || "au";
const shop = SHOPS[code], a = ADDR[code];
if (!shop || !a) { console.error(`no shop/address for ${code}`); process.exit(2); }

const OUT = join(ROOT, `tmp/urgent/${code}-human`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  recordVideo: { dir: OUT, size: { width: 1440, height: 1100 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

const api = [];
const pageErrs = [];
page.on("request", r => { const u = r.url(); if (/\/api\/v3\/store\//.test(u)) api.push({ t: Date.now(), u: u.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, "") }); });
page.on("pageerror", e => pageErrs.push(String(e.message).slice(0, 160)));

const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
// Loud, not silent: a selector that matches nothing is the fault this file had.
const fill = async (sel, v) => {
  const l = page.locator(sel).first();
  if (!(await l.count())) throw new Error(`selector matched nothing: ${sel}`);
  await l.fill(v);
};

console.log(`\n=== ${code}: walking to the payment step\n`);
await page.goto(`${shop.url}/products`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const href = await page.locator('a[href*="/products/"]').first().getAttribute("href");
await page.goto(new URL(href, shop.url).toString(), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.locator('button:has-text("Add to")').first().click();
await page.waitForTimeout(3000);
await page.locator('a[href*="/checkout/"], button:has-text("Checkout")').first().click().catch(() => {});
await page.waitForTimeout(3000);
if (!/\/checkout\//.test(page.url())) {
  await page.locator('a[href*="/cart"]').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.locator('a[href*="/checkout/"], button:has-text("Checkout")').first().click().catch(() => {});
  await page.waitForTimeout(3500);
}
console.log("checkout url:", page.url());

if (a.country) {
  const c = page.locator("#ship-country").first();
  if (await c.count()) await c.selectOption({ label: a.country }).catch(() => {});
}
await fill("#email", "probe@example.test");
await fill("#ship-first_name", "Probe");
await fill("#ship-last_name", "Tester");
await fill("#ship-address1", "12 Test Street");
await fill("#ship-city", a.city);
if (a.state) {
  const st = page.locator("#ship-state").first();
  if (await st.count()) await st.selectOption({ label: a.state }).catch(async () => { await st.selectOption(a.state).catch(() => {}); });
}
await fill("#ship-postal_code", a.postal);
await fill("#ship-phone", a.phone);
await page.waitForTimeout(6000);
await shot("01-address-filled");

const ship = await page.evaluate(() => {
  const b = document.body.innerText;
  const m = b.match(/Shipping Method([\s\S]{0,260})/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 140) : "NOT FOUND";
});
console.log("shipping section:", ship);

const cardFrame = page.frameLocator("iframe[title*='payment'], iframe[name*='__privateStripeFrame']").first();
const cardBox = cardFrame.locator("input[name='number'], input#Field-numberInput").first();
await cardBox.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
if (!(await cardBox.count())) {
  console.log("\nNo card field on this page. That is its own finding.");
  await shot("02-no-card-field");
  await ctx.close(); await browser.close(); process.exit(1);
}
await shot("02-payment-step");
console.log("card field is present.\n");

// ---- 1: what does the page do while a person just sits and reads their card?
console.log("=== sitting still for 60s");
const mark = Date.now();
let swaps = 0;
let last = await page.locator("iframe[name*='__privateStripeFrame']").first().getAttribute("name").catch(() => null);
for (let s = 0; s < 60; s += 5) {
  await page.waitForTimeout(5000);
  const n = await page.locator("iframe[name*='__privateStripeFrame']").first().getAttribute("name").catch(() => null);
  if (n && n !== last) { swaps++; last = n; }
}
const idle = api.filter(r => r.t > mark);
const byPath = {};
for (const r of idle) byPath[r.u] = (byPath[r.u] || 0) + 1;
console.log(`  API calls while idle 60s : ${idle.length}`);
for (const [p, n] of Object.entries(byPath).sort((x, y) => y[1] - x[1]).slice(0, 6)) console.log(`     ${String(n).padStart(4)}x  ${p}`);
console.log(`  card frame replaced      : ${swaps} times`);
await shot("03-after-60s-idle");

// ---- 2: type the card the way a person types it
console.log("\n=== typing 4242... one digit a second, no submit");
const before = api.length;
await cardBox.click({ timeout: 20000 });
for (const d of "4242424242424242") { await page.keyboard.type(d); await page.waitForTimeout(1000); }
const held = await cardBox.inputValue().catch(e => `UNREADABLE (${String(e.message).slice(0, 60)})`);
const digits = String(held).replace(/\D/g, "");
console.log(`  field holds  : "${held}"`);
console.log(`  digits kept  : ${digits.length} of 16  ->  ${digits.length === 16 ? "SURVIVED" : "LOST"}`);
console.log(`  API calls during typing : ${api.length - before}`);
await shot("04-card-typed-at-human-speed");

const payNow = page.getByRole("button", { name: /pay now|place order/i }).first();
console.log(`  Pay button   : present=${await payNow.count() > 0} enabled=${await payNow.count() ? await payNow.isEnabled() : "n/a"}`);

console.log("\n--- page errors");
for (const e of [...new Set(pageErrs)].slice(0, 10)) console.log("  ", e);

await ctx.close();
await browser.close();
console.log("\nshots + video in", OUT);
