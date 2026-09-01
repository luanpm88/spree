#!/usr/bin/env node
/**
 * How many products a customer can actually SEE on each of his sale pages.
 *
 * Not by reading HTML. The listing is a client island, so the server response
 * carries a heading and no products at all, on a page that works perfectly and
 * on a page that is dead. Counting anchors in that HTML returns 0 for both and
 * reads like a finding.
 *
 * cacheComponents also means a missing category answers 200 with the shell, so
 * the status code says nothing either. The title is the truth, and the card
 * count has to come from a rendered page.
 */
import { chromium } from "playwright";

// Hosts come from .estate, gitignored because it names the client's shops. This
// repository is public. An earlier version of this file hardcoded them and was
// caught by check_no_client_data before it was committed.
import { readFileSync } from "node:fs";
const SHOPS = readFileSync(new URL("../.estate", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#") && l.includes("|"))
  .map((l) => l.split("|"))
  .filter((c) => c.length >= 6 && c[5] && c[5] !== "-")
  .map((c) => c[5]);
if (SHOPS.length === 0) throw new Error(".estate gave no shop hosts to measure");
const PATHS = [
  "/c/categories/shop-specials",
  "/c/categories/shop-specials/on-sale",
  "/c/categories/shop-specials/on-sale/special-offers",
  "/c/categories/shop-specials/on-sale/combo-deals",
  "/c/categories/shop-specials/stock-clearance",
  "/c/categories/shop-specials/stock-clearance/clearance",
  "/c/collections/on-sale",
];

const browser = await chromium.launch();
const rows = [];

for (const shop of SHOPS) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  for (const path of PATHS) {
    const url = `https://${shop}${path}`;
    let title = "";
    let cards = 0;
    let sale = 0;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      title = (await page.title()).split("|")[0].trim();
      // Wait for the island to settle: either cards or the empty message.
      await page
        .waitForFunction(
          () =>
            document.querySelectorAll('a[href*="/products/"]').length > 0 ||
            /No products|Not Found/i.test(document.body.innerText),
          { timeout: 25000 },
        )
        .catch(() => {});
      cards = await page.evaluate(
        () =>
          new Set(
            [...document.querySelectorAll('a[href*="/products/"]')].map(
              (a) => a.getAttribute("href"),
            ),
          ).size,
      );
      // A struck-through price is what "on sale" looks like to a customer.
      sale = await page.evaluate(
        () => document.querySelectorAll("s, .line-through").length,
      );
    } catch (e) {
      title = `ERROR ${e.message.slice(0, 40)}`;
    }
    rows.push({ shop, path, title, cards, sale });
    const dead = /Not Found/i.test(title);
    console.log(
      `  ${shop.split(".")[0].padEnd(11)} ${path.replace("/c/categories/shop-specials", "…").padEnd(22)} ` +
        `${dead ? "DEAD" : "live"}  cards:${String(cards).padStart(3)}  struck:${String(sale).padStart(3)}  ${title}`,
    );
  }
  await ctx.close();
  console.log("");
}

await browser.close();

const dead = rows.filter((r) => /Not Found/i.test(r.title));
console.log(`  dead pages: ${dead.length}`);
for (const d of dead) console.log(`    ${d.shop}  ${d.path}`);
