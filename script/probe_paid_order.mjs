#!/usr/bin/env node
// URGENT 20 Sep: "we have not had any orders since the last fix".
//
// check_free_checkout walks a FREE item. This walks a PAID one, which is what
// every real customer does, and photographs each step. The question being
// asked is not "does the checkout load" -- it does -- but "can an order be
// placed", and only one of those is in doubt.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = (f) => readFileSync(join(ROOT, f), "utf8").split("\n")
  .filter(l => l.trim() && !l.startsWith("#")).map(l => l.split("|").map(s => s.trim()));

const ADDR = {};
// Columns, per check_free_checkout.mjs which has been right about this all
// along: shop | opensOn | pick | city | state | postal | phone.
// Reading them as 6 put "Ontario" into the postal box, and the resulting
// "zipcode is invalid" looked exactly like the fault being investigated.
const dash = (v) => (v === "-" || !v ? undefined : v);
for (const [shop, opensOn, pick, city, state, postal, phone] of rows(".checkout_probes")) {
  ADDR[shop] = { country: dash(pick) ?? dash(opensOn), city, state: dash(state), postal, phone };
}
const SHOPS = {};
for (const r of rows(".estate")) SHOPS[r[0]] = { url: r[7] };

const code = process.argv[2] || "ca";
const shop = SHOPS[code], a = ADDR[code];
if (!shop || !a) { console.error(`no shop/address for ${code}`); process.exit(2); }

const OUT = join(ROOT, `tmp/urgent/${code}-paid`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 1100 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errs = [];
page.on("pageerror", e => errs.push(String(e.message).slice(0, 130)));
page.on("response", r => { if (r.status() >= 400 && !/favicon|analytics/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 95)}`); });

const shot = async n => { await page.screenshot({ path: `${OUT}/${n}.png` }); };
const fill = async (sel, v) => { const l = page.locator(sel).first(); if (await l.count()) await l.fill(v).catch(()=>{}); };
const problems = [];

try {
  await page.goto(`${shop.url}/products`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await shot("01-products");

  // Navigate by URL rather than clicking the card: the click sometimes lands
  // on the image before the row's link is hydrated and nothing happens, which
  // is a probe fault and would be read as the shop being broken.
  const href = await page.locator('a[href*="/products/"]').first().getAttribute("href");
  await page.goto(new URL(href, shop.url).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await shot("02-product");

  const add = page.getByRole("button", { name: /add to (cart|bag)/i }).first();
  await add.waitFor({ state: "visible" });
  await add.click();
  await page.waitForTimeout(4000);
  await shot("03-added");

  // Reach checkout the way a customer does: from the cart. The bare
  // /checkout path is a 404 BY DESIGN -- the route is /checkout/[id] and the
  // id is the order -- so typing the URL measures the probe, not the shop.
  await page.goto(`${shop.url}/cart`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await shot("04-cart");
  const co = page.getByRole("link", { name: /checkout/i }).first();
  if (!(await co.count())) { problems.push("no checkout link in the cart"); }
  else { await co.click(); }
  await page.waitForTimeout(8000);
  await shot("05-checkout");

  const sel = page.locator("#ship-country").first();
  if (await sel.count()) await sel.selectOption({ label: a.country }).catch(()=>{});
  await page.waitForTimeout(1500);

  await fill("#email", "probe@example.test");
  await fill("#ship-first_name", "Probe");
  await fill("#ship-last_name", "Test");
  await fill("#ship-address1", "1 Queen Street");
  await fill("#ship-city", a.city);
  const st = page.locator("#ship-state");
  if (await st.count() && a.state) await st.first().selectOption({ label: a.state }).catch(()=>{});
  await fill("#ship-postal_code", a.postal);
  await fill("#ship-phone", a.phone);
  await page.keyboard.press("Tab");
  await shot("06-address-filled");

  console.log("waiting for a shipping quote...");
  await page.waitForTimeout(18000);
  await shot("07-after-address");

  const state = await page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      hasShippingOption: !!document.querySelector('[role="radio"], input[type="radio"]'),
      shippingText: (t.match(/Shipping Method.{0,220}/i) || [""])[0],
      hasPayNow: /pay now|place order|complete order/i.test(t),
      totalText: (t.match(/Total[^A-Za-z]{0,30}[\d.,]+/i) || [""])[0],
      errorText: (t.match(/(can't be blank|error|unavailable|no shipping|not available)[^.]{0,120}/i) || [""])[0],
    };
  });

  console.log(`\n=== ${code.toUpperCase()} paid checkout ===`);
  console.log("shipping option offered:", state.hasShippingOption);
  console.log("shipping says          :", state.shippingText.slice(0, 200) || "(nothing)");
  console.log("total                  :", state.totalText || "(none)");
  console.log("Pay Now present        :", state.hasPayNow);
  if (state.errorText) console.log("PAGE ERROR TEXT        :", state.errorText);

  if (!state.hasShippingOption) problems.push("no shipping method offered after a complete address");
  if (!state.hasPayNow) problems.push("no Pay Now button — the order cannot be placed");
} catch (e) {
  problems.push(`threw: ${String(e.message).split("\n")[0].slice(0, 140)}`);
  await shot("99-failure").catch(()=>{});
}

const seen = [...new Set(errs)].filter(e => !/418|423|425/.test(e));
if (seen.length) { console.log("\nnetwork/page errors:"); seen.slice(0, 8).forEach(e => console.log("  " + e)); }
console.log(problems.length ? `\nFAILED: ${problems.join(" · ")}` : `\nOK: an order can be placed on ${code}`);
console.log(`shots in tmp/urgent/${code}-paid/`);
await ctx.close();
await browser.close();
const { readdirSync, renameSync } = await import("node:fs");
const vid = readdirSync(OUT).filter(f => f.endsWith(".webm")).pop();
if (vid) { renameSync(join(OUT, vid), join(OUT, `order-${code}.webm`)); console.log(`video  tmp/urgent/${code}-paid/order-${code}.webm`); }
process.exit(problems.length ? 1 : 0);
