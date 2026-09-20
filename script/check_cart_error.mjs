#!/usr/bin/env node
/**
 * His cart error, reproduced with his own account and his own recipe.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * He reported an error in the cart on the AU shop. It was attempted four times
 * from his written description and never reproduced, and the reason is now
 * obvious: every attempt was as a guest. On 8 Sep he gave the recipe with the
 * missing half in it, "use these details ... then click on the cart icon top
 * right", so the fault needs a signed in customer and a basket that already
 * belongs to that customer.
 *
 * Nothing here sets anything up. It signs in and clicks, which is what he does.
 * A probe that added a line item first, or cleared the basket first, would be
 * arranging the state it is meant to be measuring, and that has already turned
 * one green report on this project into a wrong one.
 *
 * ── what it records ────────────────────────────────────────────────────────
 *
 * The visible page, the console, every failed request and every 4xx/5xx, and a
 * screenshot at each step. An error the customer sees is usually all four, and
 * whichever one carries the cause is not known in advance.
 *
 * His password is read from tmp/client, gitignored, never printed.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

const console_ = [];
const failed = [];
const bad = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    console_.push(`${m.type()}: ${m.text()}`.slice(0, 300));
});
page.on("requestfailed", (r) =>
  failed.push(`${r.method()} ${r.url().slice(0, 140)} — ${r.failure()?.errorText}`),
);
page.on("response", (r) => {
  if (r.status() >= 400)
    bad.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  return `${OUT}/${name}.png`;
};

const visibleError = () =>
  page.evaluate(() => {
    const txt = document.body.innerText;
    // Broad on purpose. What the wording is has not been seen yet, so matching
    // an expected phrase would be matching a guess.
    const hits = txt
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          /error|sorry|wrong|failed|cannot|could not|unable|try again|unexpected|problem/i.test(
            l,
          ),
      );
    return [...new Set(hits)].slice(0, 8);
  });

console.log(`signing in at https://${HOST} as ${creds.AU_TEST_EMAIL}\n`);

// 1. Sign in.
await page.goto(`https://${HOST}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await shot("1-home");

// Find the sign-in route rather than assuming it. The shops carry a country and
// locale prefix and one of them serves clean URLs, so a hardcoded path would be
// a 404 on some shops and that 404 would be reported as the finding.
const signInHref = await page.evaluate(() => {
  const a = [...document.querySelectorAll("a[href]")].find((x) =>
    /sign[-_ ]?in|login|account/i.test(x.getAttribute("href") + " " + x.textContent),
  );
  return a?.getAttribute("href") ?? null;
});
console.log(`  sign-in link found: ${signInHref ?? "NONE"}`);
await page.goto(new URL(signInHref ?? "/account", `https://${HOST}`).toString(), {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
await page.fill('input[type="email"], input[name="email"]', creds.AU_TEST_EMAIL);
await page.fill('input[type="password"], input[name="password"]', creds.AU_TEST_PASSWORD);
await shot("2-sign-in-filled");
await Promise.all([
  page.waitForLoadState("domcontentloaded").catch(() => {}),
  page.click('button[type="submit"], input[type="submit"]'),
]);
await page.waitForTimeout(5000);
console.log(`  after submit: ${page.url()}`);
await shot("3-after-sign-in");
console.log(`  visible on page: ${JSON.stringify(await visibleError())}`);

// 1b. Put the item in the basket, if one was named.
//
// Signing in as him left the basket empty, so his fault cannot be about the
// basket he already had: whatever is in his is not coming back on sign in.
// The error he described is on a free seal, so the item goes in here and the
// cart is opened after, which is his recipe with the signed in half added.
//
// ADD_SLUG rather than a slug written into this file. The seven zero priced
// products are his data and this repository is public.
if (process.env.ADD_SLUG) {
  const slug = process.env.ADD_SLUG;
  await page.goto(`https://${HOST}/products/${slug}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
  console.log(`\n  product page: ${page.url()}`);
  console.log(`  price shown:  ${await page.evaluate(() => {
    const m = document.body.innerText.match(/\$[\d,.]+/);
    return m ? m[0] : "(none)";
  })}`);
  await shot("3b-product");

  const add = page
    .locator('button:has-text("Add to"), button:has-text("ADD TO"), [data-testid*="add-to-cart"]')
    .first();
  // The button is server rendered and clickable before React attaches, which
  // has already cost this project a probe that reported one success in six.
  // Clicked until the cart cookie exists rather than once.
  for (let i = 0; i < 6; i++) {
    await add.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const cookies = await ctx.cookies();
    if (cookies.some((c) => c.name === "_spree_cart_token")) break;
  }
  const hasToken = (await ctx.cookies()).some(
    (c) => c.name === "_spree_cart_token",
  );
  console.log(`  cart token after add: ${hasToken}`);
  await shot("3c-after-add");
  console.log(`  visible on page: ${JSON.stringify(await visibleError())}`);
}

// 2. His step: click the cart icon, top right.
const cart = page
  .locator(
    'a[href*="/cart"], button[aria-label*="art" i], a[aria-label*="art" i], [data-testid*="cart"]',
  )
  .first();
const found = (await cart.count()) > 0;
console.log(`\n  cart control found: ${found}`);
if (found) {
  await cart.scrollIntoViewIfNeeded().catch(() => {});
  await cart.click({ timeout: 20000 }).catch((e) => console.log(`  click: ${e.message.split("\n")[0]}`));
  await page.waitForTimeout(6000);
} else {
  await page.goto(`https://${HOST}/cart`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
}
console.log(`  url now: ${page.url()}`);
await shot("4-cart");

const errs = await visibleError();
console.log(`\n── what the page says ──`);
console.log(errs.length ? errs.map((e) => `  ${e}`).join("\n") : "  (nothing matching)");
console.log(`\n── console ──`);
console.log(console_.length ? console_.map((e) => `  ${e}`).join("\n") : "  (clean)");
console.log(`\n── failed requests ──`);
console.log(failed.length ? failed.map((e) => `  ${e}`).join("\n") : "  (none)");
console.log(`\n── 4xx / 5xx ──`);
console.log(bad.length ? bad.map((e) => `  ${e}`).join("\n") : "  (none)");
console.log(`\nshots in ${OUT}/`);

await browser.close();
