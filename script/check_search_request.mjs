#!/usr/bin/env node
/**
 * What request does the storefront actually make when somebody searches?
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * He reported search returning nothing on three of the six shops. Six layers
 * were measured and every one came back correct for a failing shop: the data
 * (ransack(multi_search:) in the console), the API (q[search]=tanka returns 65),
 * the request replayed from outside (200, 12 items), the same call from inside
 * that shop's own container (count 65, filters total_count 65), a restart, and
 * the absence of any cache handler or volume. The page still renders the empty
 * state and "0 products".
 *
 * Every one of those measurements was a request I composed. None of them was
 * the request the storefront makes. That is the one layer left, so this reads
 * it out of the backend's own log while a real browser drives the search, and
 * prints the failing shop's line next to a working shop's for comparison.
 *
 * The browser is the instrument on purpose: these pages stream their content,
 * so curl shows an empty grid on a shop that works perfectly. That mistake has
 * already been made five times on this one question.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const TERM = process.env.TERM_QUERY ?? "tanka";
// One shop he reports as broken, one he reports as working. Read from .estate
// so no domain is written into a tracked file.
const SHOPS = (process.env.SHOPS ?? "au,ca").split(",");

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

const estate = readFileSync(".estate", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"))
  .reduce((acc, c) => {
    // The LIVE url, not the staging column.
    //
    // The shops moved on 27 and 28 August and the staging names have since been
    // retired: all fourteen of them are NXDOMAIN at their own authoritative
    // nameservers. Pointed at the old column, this probe reached the admin
    // vhost, found no h1 and no products request, and would have reported that
    // as a finding about search.
    acc[c[0]] = { storefront: (c[7] || "").replace(/^https?:\/\//, "") };
    return acc;
  }, {});

const ssh = (cmd) =>
  execFileSync(
    "ssh",
    [
      "-i", key,
      "-p", env.SSH_PORT,
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=20",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=40",
      env.SSH_HOST,
      cmd,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

// His own domains, reached the way his customers reach them, through
// Cloudflare and the live vhost. Nothing is mapped or overridden here: a probe
// that resolves a name differently from the way a customer does is measuring a
// path nobody uses.
const browser = await chromium.launch();

for (const shop of SHOPS) {
  const host = estate[shop]?.storefront;
  if (!host || host === "-") {
    console.log(`\n${shop}: no storefront domain in .estate, skipped`);
    continue;
  }
  const url = `https://${host}/products?q=${encodeURIComponent(TERM)}`;

  // A marker request first, so the log slice can be cut at a known point
  // rather than by clock arithmetic across two machines.
  // The API hostname this shop's storefront is built against, read off the
  // running container rather than assumed, and the log's length before the
  // search. Cutting the slice by line number rather than by seconds avoids
  // clock arithmetic between two machines, which is its own source of an empty
  // measurement.
  const apiHost = ssh(
    `docker exec ${shop}_storefront printenv SPREE_API_URL`,
  )
    .trim()
    .replace(/^https?:\/\//, "");
  const before = Number(
    ssh("wc -l < /var/log/nginx/access.log").trim().split(/\s+/)[0],
  );

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for the grid OR the empty state, whichever the shop produces. Waiting
  // only for product links would time out on the failing shop and the timeout
  // would then be reported as the finding.
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('a[href*="/products/"]').length > 0 ||
        !!document.body.innerText.match(/No products|no products/i),
      null,
      { timeout: 45000 },
    )
    .catch(() => {});

  const cards = await page.$$eval(
    'a[href*="/products/"]',
    (a) => a.length,
  );
  const h1 = await page.$eval("h1", (e) => e.innerText).catch(() => "(no h1)");
  const counter = await page
    .evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s+products?/i);
      return m ? m[0] : "(no counter)";
    })
    .catch(() => "(no counter)");
  await page.close();

  // nginx, not the Rails log.
  //
  // Rails is configured with a compact one line format, "[id] GET
  // /api/v3/store/products 200 68ms", which drops the query string. Grepping
  // it for the request found nothing on the WORKING shop as well as the broken
  // one, which is the tell that the instrument was wrong rather than the shop:
  // ca had just rendered 56 products, so it certainly made the call.
  //
  // The storefront reaches the API over the public hostname, so nginx sees
  // every one of these and its access log carries the whole query string.
  // No host filter. The access log is shared by every vhost and its format
  // carries no Host field, so a line cannot be attributed to a shop that way,
  // and grepping for the hostname silently matched nothing at all: the second
  // empty measurement in a row produced by the instrument rather than the shop.
  //
  // Attribution is by the query string instead. Only one shop is driven at a
  // time and a q[search] request is rare in his live traffic, so a search line
  // inside this slice is this search. Every products line in the window is
  // printed underneath so a missing search cannot be mistaken for a quiet page.
  const searchLines = ssh(
    `awk 'NR>${before}' /var/log/nginx/access.log | grep -F 'api/v3/store/products' | grep -F 'q%5Bsearch%5D' | tail -8`,
  );
  const allLines = ssh(
    `awk 'NR>${before}' /var/log/nginx/access.log | grep -cF 'api/v3/store/products' || true`,
  );
  const log = searchLines;

  console.log(`\n── ${shop} ──────────────────────────────────────────────`);
  console.log(`  browser  h1=${JSON.stringify(h1)} cards=${cards} counter=${counter}`);
  const lines = log.trim().split("\n").filter(Boolean);
  console.log(
    `  api      ${apiHost}, ${allLines.trim()} products request(s) logged in the window`,
  );
  if (!lines.length) {
    console.log("  backend  no q[search] request — the page did not ask");
  } else {
    for (const l of lines) {
      const m = l.match(/"GET ([^ ]+) HTTP/);
      const status = l.match(/HTTP\/[\d.]+" (\d+) (\d+)/);
      console.log(
        `  backend  ${m ? decodeURIComponent(m[1]) : l.trim()}` +
          (status ? `   → ${status[1]}, ${status[2]} bytes` : ""),
      );
    }
  }
}

await browser.close();
