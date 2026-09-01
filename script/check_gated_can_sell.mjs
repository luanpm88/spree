#!/usr/bin/env node
/**
 * Can a signed-in customer actually put something in the basket on a closed shop.
 *
 *   node script/check_gated_can_sell.mjs https://<host> <shop>
 *
 * Credentials come from .shopauth (gitignored), as <SHOP>_EMAIL / <SHOP>_PASSWORD.
 *
 * ── the gap this fills ──────────────────────────────────────────────────────
 *
 * On a shop that requires an account, the browser walk asks one question and
 * answers it well: is this still closed to a stranger. Sixteen checks, all green.
 * None of them is the question a shop exists to answer.
 *
 * The wholesale shop went live on 28 Aug with that as its only browser evidence.
 * Every open shop in this project gets an add-to-cart click before it is called
 * done, because on 17 Aug one rendered perfectly, answered 200 everywhere and
 * could not take an order. The closed shop was the one place that rule quietly
 * did not apply, purely because the walk could not get past the login.
 *
 * So this signs in and clicks, and it is deliberately narrow: sign in, open a
 * product, add it, and read the basket back. It does not place an order, because
 * placing one on his live wholesale shop would put a real row in his books.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [host, shop] = process.argv.slice(2);
if (!host || !shop) {
  console.error("usage: node script/check_gated_can_sell.mjs https://<host> <shop>");
  process.exit(2);
}

let email, password;
try {
  const text = readFileSync(join(ROOT, ".shopauth"), "utf8");
  const grab = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
  email = grab(`${shop.toUpperCase()}_EMAIL`);
  password = grab(`${shop.toUpperCase()}_PASSWORD`);
} catch {
  /* handled below */
}
if (!email || !password) {
  console.log(`    note  no ${shop.toUpperCase()}_EMAIL in .shopauth, cannot test selling on a closed shop`);
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const fail = (why) => {
  console.error(`    FAIL  ${why}`);
  return browser.close().then(() => process.exit(1));
};

await page.goto(`${host}/account/login`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(4000);

await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
await page.fill('input[type="password"], input[name="password"]', password).catch(() => {});
await page.getByRole("button", { name: /log ?in|sign ?in/i }).first().click({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(9000);

// Signed in is not "the login form went away". Ask for a page only an account
// reaches and check it renders as itself.
await page.goto(`${host}/products`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);
const links = await page
  .evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/products/"]')].map((a) => a.getAttribute("href")))])
  .catch(() => []);
if (links.length === 0) await fail("signed in and the catalogue shows no products. Either the sign-in did not take, or the shop is empty behind the login.");
console.log(`    ok    signed in, ${links.length} product(s) visible`);

await page.goto(host + links[0], { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);

// Read the basket count out of the header BEFORE the click. This storefront
// shows the basket as a drawer, not as a page: /cart renders the shop shell with
// no lines in the markup, so reading that page said "the basket is empty" on a
// shop that had just accepted the item. The count in the header is what a
// customer sees and what actually moved.
const countNow = async () =>
  page
    .evaluate(() => {
      // The badge inside the "Open cart" control, and nothing else.
      //
      // The first version took the first one-to-three digit run in the page text.
      // On a wholesale catalogue that is a carton quantity or a price, so it read
      // 267 before the click and 1 after, and declared a working shop broken. A
      // number scraped from prose is not a measurement.
      const control =
        document.querySelector('[aria-label="Open cart" i]') ||
        [...document.querySelectorAll("a,button")].find((e) =>
          /cart|basket|bag/i.test(e.getAttribute("aria-label") || ""),
        );
      if (!control) return null;
      const badge = [...control.querySelectorAll("*")].find(
        (e) => e.children.length === 0 && /^\d{1,3}$/.test((e.textContent || "").trim()),
      );
      return badge ? Number(badge.textContent.trim()) : 0;
    })
    .catch(() => null);

const before = await countNow();

const addButton = page.getByRole("button", { name: /add to (cart|basket)|add to bag/i }).first();
if ((await addButton.count()) === 0) await fail(`no add-to-cart button on ${links[0]}`);
await addButton.scrollIntoViewIfNeeded().catch(() => {});

// The server action, watched directly. A toast is drawn by the click handler
// whether or not the server accepted anything, so the toast proves nothing.
let accepted = false;
page.on("response", (r) => {
  if (r.request().method() === "POST" && r.status() >= 200 && r.status() < 300 && /\/products\//.test(r.url())) accepted = true;
});

await addButton.click({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(9000);
const after = await countNow();

if (!accepted) await fail("clicked add to cart and the server was never asked. This shop cannot sell.");
if (before === null || after === null) {
  // No badge to read. The POST was accepted, which is the stronger of the two
  // signals, so say what was and was not proved rather than inventing a verdict.
  console.log("    ok    add to cart accepted by the server (no cart badge on this theme to count)");
} else if (after <= before) {
  await fail(`the server accepted the add and the basket count did not move (${before} then ${after}).`);
} else {
  console.log(`    ok    add to cart accepted by the server, basket went ${before} to ${after}`);
}
await browser.close();
