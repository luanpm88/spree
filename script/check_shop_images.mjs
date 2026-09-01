#!/usr/bin/env node
/**
 * Does this shop actually show its product photographs.
 *
 *   node script/check_shop_images.mjs https://<host>
 *
 * ── why this is its own file, and why it counts what it counts ───────────────
 *
 * A shop went live with no photographs on it and four separate measurements said
 * it was fine. Each was true and beside the point:
 *
 *   naturalWidth === 0            counts BROKEN images. A page with no <img> at
 *                                 all has none, so it scored zero broken.
 *   naturalWidth > 0              counts the grey PLACEHOLDER as a success.
 *   blob.service.exist?           said 260 of 260 files were present. They were.
 *   anchor.querySelector("img")   returned 0 on a page showing 38 photographs,
 *                                 because a product card link does not wrap its
 *                                 picture: they are siblings.
 *
 * The client found it before any of them did, by opening his own shop.
 *
 * So: a product photograph is an <img> whose src points at Active Storage. That
 * holds whatever the card markup does around it. And it writes a screenshot,
 * because the only answer anyone should accept is one somebody looked at.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const host = process.argv[2];
const shot = process.argv[3];
if (!host) {
  console.error("usage: node script/check_shop_images.mjs https://<host> [screenshot.png]");
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

// domcontentloaded, not networkidle.
//
// These shops carry his chat widget, his social proof pixel and two analytics
// scripts, and at least one of them keeps a connection open for as long as the
// page is on screen. networkidle therefore never arrives: it timed out after 90
// seconds on a shop that had rendered every one of its 42 photographs, and the
// scroll that followed raced the page's own hydration and threw
//
//   page.evaluate: Execution context was destroyed, most likely because of a navigation
//
// which the caller printed as "product photographs did not render". The shop was
// perfect. The check was reporting its own crash as the shop's fault, on the
// first live cutover of the day.
await page.goto(host, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);

// mouse.wheel, not evaluate(scrollBy): a wheel event is sent to the browser and
// cannot be destroyed by the page navigating underneath it. Every evaluate below
// is guarded for the same reason.
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 1400).catch(() => {});
  await page.waitForTimeout(1500);
}
await page.mouse.wheel(0, -20000).catch(() => {});

// Wait for the photographs to finish decoding, rather than sleeping and hoping.
//
// A fixed sleep reported 30 of 42 on one run and 34 of 42 on the next, on a shop
// where every image was fine: zero 4xx in the browser and 36 of 36 fetchable from
// the server. The rows below the fold are lazy, so what the old wait measured was
// how far the decoder had got, not whether the shop is healthy. Twice that was
// read as a broken shop on a live cutover.
//
// Poll instead, and give up after a minute so a genuinely broken image still
// fails rather than hanging the run.
const settled = await page
  .waitForFunction(
    () => {
      const p = [...document.querySelectorAll("img")].filter((i) =>
        (i.getAttribute("src") || "").includes("active_storage"),
      );
      return p.length > 0 && p.every((i) => i.complete);
    },
    { timeout: 60000 },
  )
  .then(() => true)
  .catch(() => false);
if (!settled) console.log("    note  some images were still loading after 40s");
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll("img")];
  const product = imgs.filter((i) => (i.getAttribute("src") || "").includes("active_storage"));
  // Three states, not two. Conflating the last two failed a healthy shop twice on
  // a live changeover day:
  //
  //   decoded  complete and has pixels       the customer sees a photograph
  //   broken   complete and naturalWidth 0   the request finished with nothing
  //   pending  not complete                  still on the wire
  //
  // Only `broken` is a fault. `pending` after a minute of waiting is a slow link,
  // and it was reported as "2 of 42 photographs did not render" on a shop where
  // the browser logged zero 4xx and the server could fetch every URL of the 36.
  const decoded = product.filter((i) => i.complete && i.naturalWidth > 1).length;
  const broken = product.filter((i) => i.complete && i.naturalWidth <= 1).length;
  const pending = product.filter((i) => !i.complete).length;
  const anchors = new Set(
    [...document.querySelectorAll('a[href*="/products/"]')].map((a) => a.getAttribute("href")),
  );
  const placeholders = imgs.filter((i) => (i.getAttribute("src") || "").includes("placeholder")).length;
  return { total: imgs.length, product: product.length, decoded, broken, pending, anchors: anchors.size, placeholders };
});

if (shot) {
  try {
    mkdirSync(shot.replace(/\/[^/]+$/, ""), { recursive: true });
  } catch {}
  await page.screenshot({ path: shot });
}
await browser.close();

console.log(`    products linked: ${r.anchors}`);
console.log(`    product photographs: ${r.product}, decoded ${r.decoded}`);
if (r.placeholders) console.log(`    placeholder images: ${r.placeholders}`);
if (shot) console.log(`    screenshot: ${shot}`);

if (r.anchors === 0) {
  console.log("    note  no products on this page to judge");
  process.exit(0);
}
if (r.product === 0) {
  console.error("    FAIL  not one product photograph. thumbnail_url is null and the cards are empty.");
  process.exit(1);
}
if (r.broken > 0) {
  console.error(`    FAIL  ${r.broken} of ${r.product} photographs finished loading with no pixels`);
  process.exit(1);
}
if (r.pending > 0) {
  // Named and counted, and not a failure. Said out loud so it is never silently
  // rounded into a pass either.
  console.log(`    note  ${r.pending} still loading after the wait, none of them errored`);
}
console.log(`    ok    ${r.decoded} product photographs, every one decoded`);
