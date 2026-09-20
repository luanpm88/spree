#!/usr/bin/env node
/**
 * Search the same term twice, and watch what the cache does in between.
 *
 * ── the state this starts from ──────────────────────────────────────────────
 *
 * Measured on his live shops on 8 Sep. A term nobody has searched produces
 * exactly the right API call on every shop, "q[search]=<term>", 200. A term
 * that has been searched produces NO call at all: au renders 0 products and ca
 * renders 56, both without asking Spree. So the answer on the page is a cached
 * one, and au's cached answer is empty.
 *
 * cacheLife("tenMinutes") in next.config declares stale 300, revalidate 600,
 * expire 3600. Stale-while-revalidate means the empty entry is served at once
 * and a refresh runs behind the response, which is why the first measurement
 * saw no request: the refresh lands after the page has already been sent.
 *
 * What has never been measured is what that refresh comes back with. If it
 * returns his 65 products then the entry heals and the fault is a stale entry
 * that needs clearing once. If it returns nothing, then the storefront's own
 * request really does get zero where the same query by hand gets 65, and the
 * difference has to be in what the storefront sends that a hand made request
 * does not, which is headers rather than query string.
 *
 * The response SIZE in the access log is what separates those two, with no
 * guessing: an empty products response is about 110 bytes and 65 products with
 * media expanded is hundreds of kilobytes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const TERM = process.env.TERM_QUERY ?? "tanka";
const SHOP = process.env.SHOP ?? "au";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 25000);

const env = Object.fromEntries(
  readFileSync(".estate.env", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const key = env.SSH_KEY.replace(/^\$HOME/, process.env.HOME).replace(
  /^~/,
  process.env.HOME,
);
const host = readFileSync(".estate", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"))
  .find((c) => c[0] === SHOP)?.[7]
  ?.replace(/^https?:\/\//, "");
if (!host) throw new Error(`no live url for ${SHOP} in .estate`);

const ssh = (cmd) =>
  execFileSync(
    "ssh",
    ["-i", key, "-p", env.SSH_PORT, "-o", "BatchMode=yes",
     "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15",
     "-o", "ServerAliveCountMax=40", env.SSH_HOST, cmd],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

const lineCount = () =>
  Number(ssh("wc -l < /var/log/nginx/access.log").trim().split(/\s+/)[0]);

const searchLinesSince = (n) =>
  ssh(
    `awk 'NR>${n}' /var/log/nginx/access.log | grep -F 'api/v3/store/products' | grep -F 'q%5Bsearch%5D=${TERM}' || true`,
  )
    .trim()
    .split("\n")
    .filter(Boolean);

const describe = (l) => {
  const req = l.match(/"GET ([^ ]+) HTTP/);
  const res = l.match(/HTTP\/[\d.]+" (\d+) (\d+)/);
  const path = req ? decodeURIComponent(req[1]) : l;
  const bytes = res ? Number(res[2]) : -1;
  const verdict =
    bytes < 0 ? "" : bytes < 400 ? "  ← EMPTY result" : "  ← has products";
  return `${path}   ${res ? res[1] : "?"}, ${bytes} bytes${verdict}`;
};

const browser = await chromium.launch();
const url = `https://${host}/products?q=${encodeURIComponent(TERM)}`;

async function look(label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('a[href*="/products/"]').length > 0 ||
        /no products/i.test(document.body.innerText),
      null,
      { timeout: 45000 },
    )
    .catch(() => {});
  const cards = await page.$$eval('a[href*="/products/"]', (a) => a.length);
  const counter = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s+products?/i);
    return m ? m[0] : "(no counter)";
  });
  await page.close();
  console.log(`  ${label.padEnd(22)} cards=${cards}  counter=${counter}`);
  return cards;
}

console.log(`${SHOP} · https://${host}/products?q=${TERM}\n`);

const t0 = lineCount();
await look("first view");
// The refresh runs after the response, so the log has to be read after a wait
// rather than immediately. Not a fixed sleep dressed up as a measurement: the
// wait is stated, and what it is waiting for is named.
console.log(`  waiting ${SETTLE_MS / 1000}s for the background refresh`);
await new Promise((r) => setTimeout(r, SETTLE_MS));

const during = searchLinesSince(t0);
if (!during.length) {
  console.log("  no q[search] request at all — nothing refreshed");
} else {
  for (const l of during) console.log(`  refresh: ${describe(l)}`);
}

const t1 = lineCount();
await look("second view");
await new Promise((r) => setTimeout(r, SETTLE_MS));
const after = searchLinesSince(t1);
for (const l of after) console.log(`  refresh: ${describe(l)}`);
if (!after.length) console.log("  no q[search] request on the second view either");

await browser.close();
