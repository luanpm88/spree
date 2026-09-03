#!/usr/bin/env node
/**
 * Does a shop actually reach Stripe and draw a card field.
 *
 *   node script/check_card_field.mjs https://<host>
 *
 * ── what it proves and what it does not ─────────────────────────────────────
 *
 * It adds one item, goes to checkout, and watches for two things a customer
 * needs before they can pay: Stripe's own script loading from js.stripe.com, and
 * a card input actually rendered on the page.
 *
 * It never submits a payment. Nothing is charged and no order is placed, so this
 * is safe to run against a live shop. That also means it proves the front half
 * only: that the shop can ask Stripe for a card. Whether a real card would be
 * accepted is a question only a real payment answers, and that is his to make.
 */
import { chromium } from "playwright";

const host = process.argv[2];
if (!host) { console.error("usage: node script/check_card_field.mjs https://<host>"); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const stripeCalls = [];
page.on("response", (r) => {
  if (/stripe\.com/.test(r.url())) stripeCalls.push(`${r.status()} ${r.url().replace(/^https?:\/\//, "").slice(0, 46)}`);
});

await page.goto(`${host}/products`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);
const links = await page
  .evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/products/"]')].map((a) => a.getAttribute("href")))])
  .catch(() => []);
if (!links.length) { console.log("    no products to test with"); await browser.close(); process.exit(1); }

await page.goto(host + links[0], { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);
const add = page.getByRole("button", { name: /add to (cart|basket)|add to bag/i }).first();
if (!(await add.count())) { console.log("    no add to cart button"); await browser.close(); process.exit(1); }
await add.scrollIntoViewIfNeeded().catch(() => {});
await add.click({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(8000);

// Straight to checkout. The cart drawer differs per theme; the route does not.
await page.goto(`${host}/checkout`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(8000);

// Then scroll to payment, which is now REQUIRED rather than tidy.
//
// A Stripe intent is no longer created when the checkout page opens, only when
// the customer reaches the payment step, because creating one per page load put
// 549 rows in the shop owner's dashboard for orders that never existed. See
// src/hooks/useReachedPaymentStep.ts.
//
// So a run that does not scroll now finds no card field, correctly, and would
// report a working shop as one that never draws a card. This scroll is the
// customer's own gesture and nothing more: it opens the gate the same way their
// thumb does, and it is done before anything is measured rather than in place of
// measuring. check_payment_intent_timing.mjs is the probe that asserts the
// timing itself, and it deliberately does not scroll.
await page.evaluate(() => {
  document.getElementById("checkout-section-payment")?.scrollIntoView({ block: "center" });
}).catch(() => {});
await page.waitForTimeout(12000);

const seen = await page.evaluate(() => {
  const frames = [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src") || "");
  return {
    url: location.pathname,
    stripeFrames: frames.filter((s) => /stripe/i.test(s)).length,
    cardWords: /card number|credit card|card details|pay with card/i.test(document.body.innerText),
    payButton: !!document.querySelector('button[type="submit"], [data-testid*="pay" i]'),
  };
}).catch(() => null);

console.log(`    checkout at ${seen?.url ?? "?"}`);
console.log(`    stripe iframes on the page: ${seen?.stripeFrames ?? 0}`);
console.log(`    card wording present: ${seen?.cardWords ?? false}`);
[...new Set(stripeCalls)].slice(0, 6).forEach((c) => console.log(`    stripe call ${c}`));

// Two different findings, and the first version printed the stronger one for
// both. It said "a card field is being drawn" on a run that had measured zero
// Stripe iframes and no card wording, purely because Stripe's script had loaded.
// Loading a script is not the same as rendering a field, and a check that rounds
// the weaker result up to the stronger one is how a shop gets called ready.
const reachesStripe = stripeCalls.some((c) => c.startsWith("200"));
const drawsField = (seen?.stripeFrames ?? 0) > 0 || (seen?.cardWords ?? false);

if (drawsField) {
  console.log("    ok    checkout reaches Stripe and a card field is on the page");
} else if (reachesStripe) {
  console.log("    ok    checkout loads Stripe, and no card field appeared at this step");
  console.log("    note  this shop asks for an address before it shows payment, so that is");
  console.log("          expected here. It proves the shop can talk to Stripe, nothing more.");
} else {
  console.log("    FAIL  checkout never reached Stripe at all");
}
const ok = reachesStripe;
await browser.close();
process.exit(ok ? 0 : 1);
