#!/usr/bin/env node
/**
 * Is the empty search page coming from Cloudflare rather than from the shop?
 *
 * ── everything that was measured before this ────────────────────────────────
 *
 * Search returns nothing on three of his six shops. Measured and correct: the
 * data in the console, the API by hand (65 rows), the same call from inside
 * that shop's own container, the request replayed from outside, a container
 * restart, and the absence of any cache handler or volume. Then, with the
 * browser driving and the access log read: a term nobody has searched produces
 * exactly the right call and a correct answer, and a term that HAS been
 * searched produces no call at all. Twice, twenty five seconds apart, with no
 * background refresh either.
 *
 * A page that answers without the origin being asked is not the shop's cache.
 * cacheLife("tenMinutes") expires in an hour and a stale-while-revalidate would
 * have shown a refresh in the log. His live domains are proxied, so the
 * remaining candidate is the edge.
 *
 * ── the two tests ──────────────────────────────────────────────────────────
 *
 * cf-cache-status on the document says whether the edge served it. And the same
 * search under a different cache key, one spare parameter added, separates the
 * page from the copy of it: if ?q=tanka is empty and ?q=tanka&cb=1 is full,
 * then the shop works and only the stored copy is empty.
 *
 * The second test is the one that cannot be argued with, so it is run even when
 * the header already answers.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const TERM = process.env.TERM_QUERY ?? "tanka";
const estate = readFileSync(".estate", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"))
  .reduce((a, c) => {
    a[c[0]] = (c[7] || "").replace(/^https?:\/\//, "");
    return a;
  }, {});

// Every shop in .estate unless told otherwise. Not a list written here: a shop
// name is one of his brands and this repository is public, which is what
// check_no_client_data caught on the first version of this file.
const SHOPS = (process.env.SHOPS ?? Object.keys(estate).join(",")).split(",");

const browser = await chromium.launch();

async function view(host, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let hdrs = {};
  let status = 0;
  const target = `https://${host}${path}`;
  page.on("response", (r) => {
    if (r.url() === target) {
      status = r.status();
      hdrs = r.headers();
    }
  });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
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
    return m ? m[1] : "?";
  });
  await page.close();
  return {
    status,
    cards,
    counter,
    cf: hdrs["cf-cache-status"] ?? "(none)",
    age: hdrs.age ?? "-",
    cc: (hdrs["cache-control"] ?? "-").slice(0, 40),
  };
}

for (const shop of SHOPS) {
  const host = estate[shop];
  if (!host) {
    console.log(`\n${shop}: not in .estate`);
    continue;
  }
  const plain = await view(host, `/products?q=${encodeURIComponent(TERM)}`);
  // One spare parameter the app does not read, so the shop renders exactly the
  // same page and the edge stores it under a different key.
  const busted = await view(
    host,
    `/products?q=${encodeURIComponent(TERM)}&cb=${Math.floor(Date.now() / 1000)}`,
  );

  console.log(`\n── ${shop} · ${host} ────────────────────────`);
  console.log(
    `  ?q=${TERM}          cards=${String(plain.cards).padStart(2)} counter=${plain.counter.padStart(3)}  cf=${plain.cf} age=${plain.age}`,
  );
  console.log(
    `  ?q=${TERM}&cb=…     cards=${String(busted.cards).padStart(2)} counter=${busted.counter.padStart(3)}  cf=${busted.cf} age=${busted.age}`,
  );
  console.log(`  cache-control    ${plain.cc}`);
  if (plain.cards === 0 && busted.cards > 0)
    console.log(
      "  VERDICT          the shop works; the stored copy under this key is empty",
    );
  else if (plain.cards === busted.cards)
    console.log("  VERDICT          same both ways, so not the cache key");
}

await browser.close();
