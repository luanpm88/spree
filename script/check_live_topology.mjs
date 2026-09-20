#!/usr/bin/env node
/**
 * Which app answers on which hostname, right now.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * On 8 Sep every staging hostname in .estate stopped resolving. Fourteen names,
 * NXDOMAIN at their own authoritative nameservers. That looked like an outage
 * and was nearly reported as one. It was not: the vhost list on the box carries
 * two generations of names, the newer <shop>-store.<zone> shape resolves fine,
 * and the old store.<shop>.<zone> shape had simply been retired.
 *
 * So .estate is stale, and a stale topology file is worse than none: every
 * probe that reads it measures a hostname nobody uses and reports whatever the
 * default vhost says. This asks the running system instead, and prints what
 * each name serves so the file can be corrected from a measurement.
 *
 * The distinction it draws is admin versus storefront. Rails redirects / to
 * /admin and sends an x-runtime header; the Next storefront renders a shop.
 * Both answer 200 to a HEAD of /, which is why this looks at the page.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// Read from .estate, which is gitignored because it names his shops. The first
// version of this file listed the domains inline and check_no_client_data
// refused it, correctly.
//
// Two names per shop: the live address, and the admin under the newer
// <shop>-store.<zone> shape. The second is derived rather than listed because
// the .estate columns still hold the retired staging names.
const estate = readFileSync(".estate", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"));

const CANDIDATES = process.env.HOSTS
  ? process.env.HOSTS.split(",")
  : estate.flatMap((c) => {
      const live = (c[7] || "").replace(/^https?:\/\//, "");
      if (!live) return [];
      const parts = live.split(".");
      const zone = parts.slice(-2).join(".");
      // A shop on a subdomain puts its admin at <label>-store.<zone>. A shop on
      // the bare apex has no label to prefix, and its admin is store.<zone>.
      // Getting this wrong is not harmless: the whole reason this file exists is
      // that a probe pointed at a hostname nobody uses and reported what the
      // wrong vhost said.
      const admin =
        parts.length > 2 ? `${parts[0]}-store.${zone}` : `store.${zone}`;
      return [live, admin];
    });

const browser = await chromium.launch();
const rows = [];

for (const host of CANDIDATES) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  let status = 0;
  let headers = {};
  page.on("response", (r) => {
    if (r.url().replace(/\/$/, "") === `https://${host}`) {
      status = r.status();
      headers = r.headers();
    }
  });
  let finalUrl = "";
  let title = "";
  let generator = "";
  let note = "";
  try {
    const resp = await page.goto(`https://${host}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    if (resp) {
      status = status || resp.status();
      headers = Object.keys(headers).length ? headers : resp.headers();
    }
    finalUrl = page.url();
    title = await page.title();
    // Next puts a __next_f script bootstrap on every page it renders; Rails
    // admin does not. Reading a marker in the DOM beats reading a header,
    // because Cloudflare rewrites headers and does not rewrite the document.
    generator = await page.evaluate(() => {
      const next = !!document.querySelector(
        'script[src*="/_next/"], #__next, [data-nextjs-router]',
      );
      const nextData = /self\.__next_f/.test(document.documentElement.innerHTML);
      const rails = !!document.querySelector(
        'meta[name="csrf-param"], form[action*="/admin"]',
      );
      return next || nextData ? "next storefront" : rails ? "rails" : "unknown";
    });
  } catch (e) {
    note = e.message.split("\n")[0];
  }
  await page.close();
  rows.push({ host, status, finalUrl, title, generator, note });
}

const w = Math.max(...rows.map((r) => r.host.length));
for (const r of rows) {
  console.log(
    `  ${r.host.padEnd(w)}  ${String(r.status).padEnd(4)} ${r.generator.padEnd(15)} ${JSON.stringify(r.title).slice(0, 46)}`,
  );
  if (r.finalUrl && !r.finalUrl.startsWith(`https://${r.host}/`))
    console.log(`  ${" ".repeat(w)}  → ${r.finalUrl}`);
  if (r.note) console.log(`  ${" ".repeat(w)}  ! ${r.note}`);
}

await browser.close();
