#!/usr/bin/env node
/**
 * Every image URL a shop's pages point at, printed one per line.
 *
 *   node script/image_origin_sweep.mjs https://<host>
 *
 * Collecting only. script/check_image_origin then asks the SERVER whether each
 * one resolves, which is the question that matters and the one a browser on a
 * laptop cannot answer. See that file for why.
 *
 * ── it lives here, not in a temp directory ──────────────────────────────────
 *
 * The first version was written to a mktemp directory by the shell script that
 * uses it. Node resolves `playwright` from node_modules upward from the FILE, so
 * outside the repository the import fails, the sweep printed nothing, and the
 * caller read an empty list as "not one image URL on this shop" and reported the
 * blank-thumbnail fault on a shop with 46 perfectly good photographs.
 *
 * ── src and srcset, both ────────────────────────────────────────────────────
 *
 * The browser fetches one width out of a srcset and leaves the rest unasked. On
 * the shop where the stale-edge fault was found, the failing URLs were widths
 * nothing on screen had requested, so watching network traffic would have missed
 * them. Every candidate is taken from the markup instead.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2];
const shop = process.argv[3] || "";
if (!base) {
  console.error("usage: node script/image_origin_sweep.mjs https://<host> [shop]");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const urls = new Set();

// A closed shop shows a stranger a login form and no products at all, so an
// anonymous sweep returns nothing and the caller reads "not one image URL on this
// shop" as the blank-thumbnail fault. It reported exactly that on a wholesale shop
// whose 37 products all had photographs.
//
// So sign in first when this shop has credentials. Behind the login is where its
// images are, and they are the ones a customer sees.
if (shop) {
  let email, password;
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const text = readFileSync(join(root, ".shopauth"), "utf8");
    const grab = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
    email = grab(`${shop.toUpperCase()}_EMAIL`);
    password = grab(`${shop.toUpperCase()}_PASSWORD`);
  } catch {
    /* an open shop has no entry, which is fine */
  }
  if (email && password) {
    await page
      .goto(`${base}/account/login`, { waitUntil: "domcontentloaded", timeout: 90000 })
      .catch(() => {});
    await page.waitForTimeout(5000);
    await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
    await page.fill('input[type="password"], input[name="password"]', password).catch(() => {});
    await page
      .getByRole("button", { name: /log ?in|sign ?in/i })
      .first()
      .click({ timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(9000);
  }
}

const grab = async () => {
  // mouse.wheel rather than evaluate(scrollBy): a wheel event survives the page
  // navigating underneath it, and these shops do navigate during hydration.
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1300).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2500);
  const found = await page
    .evaluate(() =>
      [...document.querySelectorAll("img")]
        .flatMap((i) => [
          i.getAttribute("src") || "",
          ...(i.getAttribute("srcset") || "")
            .split(",")
            .map((s) => s.trim().split(" ")[0]),
        ])
        .filter((s) => s.includes("_next/image"))
        .map((s) =>
          decodeURIComponent(s.replace(/^.*?url=/, "").replace(/&w=.*$/, "")),
        ),
    )
    .catch(() => []);
  for (const u of found) urls.add(u);
};

const paths = [
  "/",
  "/products",
  "/c/collections/on-sale",
  "/c/collections/new-products",
];
for (const path of paths) {
  await page
    .goto(base + path, { waitUntil: "domcontentloaded", timeout: 90000 })
    .catch(() => {});
  await page.waitForTimeout(4000);
  await grab();
}

// A few real product pages. Their galleries carry sizes no listing page uses.
const links = await page
  .evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll('a[href*="/products/"]')].map((a) =>
          a.getAttribute("href"),
        ),
      ),
    ].slice(0, 8),
  )
  .catch(() => []);
for (const l of links) {
  await page
    .goto(base + l, { waitUntil: "domcontentloaded", timeout: 90000 })
    .catch(() => {});
  await page.waitForTimeout(3500);
  await grab();
}

console.log([...urls].filter((u) => u.startsWith("http")).join("\n"));
await browser.close();
