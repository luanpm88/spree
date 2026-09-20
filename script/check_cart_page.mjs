#!/usr/bin/env node
/**
 * The cart page, signed in, with the order in whatever state it is already in.
 *
 * ── the state this starts from ──────────────────────────────────────────────
 *
 * His cart error was attempted four times as a guest and never reproduced. On
 * 8 Sep he gave a login and the recipe. Signed in as him, the drawer opens
 * cleanly and the free seal goes in at $0.00, so that is not it either.
 *
 * What the database then showed is the thing worth chasing. His account has
 * exactly one order, the one this probing just created, and its state is
 * `address` rather than `cart`. Nothing here went to the checkout. An order
 * that has left the cart state while still being somebody's basket is the
 * shape of fault that shows up as an error when the cart is opened, and it
 * would explain why a guest with a fresh basket never sees it.
 *
 * So this opens the cart page and the drawer without adding anything, and
 * records what the page, the console and the network say. It changes nothing:
 * the point is to read the state that is already there.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "tmp/annotated/cart-error";
mkdirSync(OUT, { recursive: true });
const creds = Object.fromEntries(
  readFileSync("tmp/client/au-test-account.env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
// The shop's live address, read from .estate rather than written here. The
// first version of this file had the domain inline and check_no_client_data
// refused it: a shop domain is client material and this repository is public.
const SHOP = process.env.SHOP ?? "au";
const HOST =
  process.env.HOST ??
  readFileSync(".estate", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("|"))
    .find((c) => c[0] === SHOP)?.[7]
    ?.replace(/^https?:\/\//, "");
if (!HOST) throw new Error(`no live url for ${SHOP} in .estate`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
const bad = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
page.on("response", (r) => {
  if (r.status() >= 400)
    bad.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 130)}`);
});

await page.goto(`https://${HOST}/account`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
await page.fill('input[type="email"], input[name="email"]', creds.AU_TEST_EMAIL);
await page.fill('input[type="password"], input[name="password"]', creds.AU_TEST_PASSWORD);
await page.click('button[type="submit"], input[type="submit"]');
await page.waitForTimeout(6000);
console.log(`signed in: ${page.url()}`);

for (const path of ["/cart", "/checkout"]) {
  errors.length = 0;
  bad.length = 0;
  await page.goto(`https://${HOST}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(8000);
  const text = await page.evaluate(() =>
    document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 14),
  );
  const name = path.replace(/\//g, "") || "root";
  await page.screenshot({ path: `${OUT}/5-${name}.png`, fullPage: false });
  console.log(`\n── ${path} → ${page.url()}`);
  console.log(text.map((l) => `  | ${l}`).join("\n"));
  if (errors.length) console.log(`  console: ${errors.join(" ~ ")}`);
  if (bad.length) console.log(`  http:    ${bad.join(" ~ ")}`);
  console.log(`  shot:    ${OUT}/5-${name}.png`);
}

await browser.close();
