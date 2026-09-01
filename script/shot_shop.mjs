// Screenshots of a deployed shop, for sending to the client.
//
//   node script/shot_shop.mjs https://shop.example.com ca en /tmp/shots
//
// He asked for these by name: "can you send me a screen shot as not many changes
// show from my end". A shop on a temporary domain is one he has to go and find,
// and a picture in the thread is the difference between him seeing a change today
// and seeing it next time he remembers to look.
//
// Full page rather than viewport: the things that change most often here are the
// footer and the panels below the fold, which a 900px tall shot never contains.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("playwright");

const BASE = (process.argv[2] || "").replace(/\/$/, "");
const COUNTRY = process.argv[3] || "ca";
const LOCALE = process.argv[4] || "en";
const OUT = process.argv[5] || "/tmp/shop-shots";
if (!BASE) {
  console.error("usage: node script/shot_shop.mjs <https://host> [country] [locale] [outdir]");
  process.exit(2);
}
const SHOP = `${BASE}/${COUNTRY}/${LOCALE}`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Lazy images decide when they are scrolled to, and a full page shot taken
// before that is a page of grey squares. This has caught the shot out twice.
const settle = async () => {
  await page.evaluate(async () => {
    await new Promise((done) => {
      let y = 0;
      const t = setInterval(() => {
        window.scrollBy(0, 800);
        y += 800;
        if (y >= document.body.scrollHeight) {
          clearInterval(t);
          window.scrollTo(0, 0);
          setTimeout(done, 2000);
        }
      }, 80);
    });
  });
  await page.waitForTimeout(1200);
};

const shots = [
  ["home", SHOP],
  ["faq", `${SHOP}/pages/faq`],
  ["about", `${SHOP}/pages/about`],
  ["products", `${SHOP}/products`],
];

for (const [name, url] of shots) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await settle();
  const file = path.join(OUT, `${COUNTRY}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ${file}`);
}

// One with a product card hovered, because the swap to the second photograph is
// the one change that cannot be seen in a still of the page at rest.
await page.goto(`${SHOP}/products`, { waitUntil: "networkidle", timeout: 120000 });
await settle();
const card = page.locator("div.group").first();
await card.scrollIntoViewIfNeeded();
await card.hover();
await page.waitForTimeout(1200);
const hoverFile = path.join(OUT, `${COUNTRY}-hover.png`);
await page.screenshot({ path: hoverFile });
console.log(`  ${hoverFile}  (a card hovered, showing its second photograph)`);

await browser.close();
