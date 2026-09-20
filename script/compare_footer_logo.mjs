#!/usr/bin/env node
/**
 * His footer logo, his three files, side by side on his own green.
 *
 * ── why this script exists ──────────────────────────────────────────────────
 *
 * This logo has been got wrong twice by reading numbers instead of looking at
 * the picture. First the header PNG was called fine because 1283x177 matched
 * the SVG viewBox, which compared dimensions and never the alpha channel: the
 * file is colour type 2 and can never be transparent. Then his footer SVG was
 * measured as clipped, retracted on the strength of two display="none" text
 * elements, and only settled when the two were finally rendered next to each
 * other.
 *
 * So the rule for this asset is: render it, then look. The numbers go in the
 * caption, not in the conclusion.
 *
 * Files are inlined as data URIs on purpose. A file:// src inside
 * page.setContent loads nothing and reports no error, which has already
 * produced one empty measurement here.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const GREEN = "#4D5538";
const BRAND = "storefront/public/brand";

const dataUri = (path) => {
  const buf = readFileSync(path);
  const mime = path.endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
};

const CANDIDATES = [
  {
    label: "his new PNG (8 Sep zip)",
    note: "596x489, RGBA, artwork flush to all four edges",
    path: "tmp/client/footer-logo-v2/Logo_business-FOOTER-white.png",
  },
  {
    label: "his SVG (4 Sep zip)",
    note: 'viewBox 595.73 wide, unmodified',
    path: `${BRAND}/logo-footer-business.svg`,
  },
  {
    label: "what is live now",
    note: "same artwork, viewBox widened to 617.42",
    path: `${BRAND}/logo-footer-business-fitted.svg`,
  },
];

const cell = (c) => `
  <figure>
    <div class="plate"><img src="${dataUri(c.path)}" alt=""></div>
    <figcaption><b>${c.label}</b><br><span>${c.note}</span></figcaption>
  </figure>`;

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 13px -apple-system, system-ui, sans-serif; background: #fff; }
  h1 { font-size: 15px; margin: 20px 24px 4px; }
  p.sub { margin: 0 24px 18px; color: #555; }
  .row { display: flex; gap: 0; }
  figure { margin: 0; flex: 1; }
  .plate { background: ${GREEN}; padding: 28px 20px; display: flex;
           align-items: center; justify-content: center; min-height: 220px; }
  .plate img { width: 185px; height: auto; display: block; }
  figcaption { padding: 10px 16px 22px; text-align: center; }
  figcaption span { color: #666; font-size: 12px; }
  .full .plate img { width: auto; max-width: 100%; }
</style>
<h1>His footer logo, rendered at the 185px the design calls for</h1>
<p class="sub">Same green as the footer, ${GREEN}. Nothing scaled by hand.</p>
<div class="row">${CANDIDATES.map(cell).join("")}</div>
<h1>The same three at their own natural width</h1>
<p class="sub">So a cut edge shows as a cut edge rather than as a scaling artefact.</p>
<div class="row full">${CANDIDATES.map(cell).join("")}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
await page.setContent(html);

// A data URI cannot 404, but it can be invalid: a comment before <?xml?> made
// one of these files unparseable once and the footer showed a broken-image
// icon. naturalWidth is 0 for anything the browser could not decode.
const decoded = await page.$$eval("img", (imgs) =>
  imgs.map((i) => ({ w: i.naturalWidth, h: i.naturalHeight })),
);
decoded.forEach((d, i) => {
  if (!d.w) throw new Error(`image ${i} did not decode: ${JSON.stringify(d)}`);
});
console.log("decoded:", JSON.stringify(decoded));

await page.screenshot({ path: "tmp/annotated/footer-logo-compare.png", fullPage: true });
await browser.close();
console.log("wrote tmp/annotated/footer-logo-compare.png");
