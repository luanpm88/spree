#!/usr/bin/env node
/**
 * Is his new footer PNG tight-cropped, or clipped?
 *
 * A tight crop and a clip look identical in the numbers: in both, ink sits on
 * the last row. They differ in what is missing. So the same artwork is
 * rasterised from the vector at the PNG's own width, and the two are compared
 * element by element: the underline rule's height, and where the last letter
 * ends.
 *
 * The vector reference is the fitted SVG, whose only difference from his 4 Sep
 * file is a wider viewBox, so it holds the artwork at full extent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const W = 596;
const svg = readFileSync(
  "storefront/public/brand/logo-footer-business-fitted.svg",
  "utf8",
);
const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: 600 },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<style>html,body{margin:0}img{width:${W}px;display:block}</style>` +
    `<img src="${uri}">`,
);
const box = await page.$eval("img", (i) => {
  if (!i.naturalWidth) throw new Error("svg did not decode");
  const r = i.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log("vector rasterised at", box.w, "x", box.h);
const shot = await page.locator("img").screenshot({ omitBackground: true });
writeFileSync("tmp/annotated/footer-logo-vector-596.png", shot);
await browser.close();
console.log("wrote tmp/annotated/footer-logo-vector-596.png");
