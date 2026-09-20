#!/usr/bin/env node
/**
 * Every shop's search box returns results, measured in a browser.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * Search returned nothing on two of the seven shops for weeks. The client found
 * it, not us. Nothing in check_all could have: the one browser walk it runs
 * clicks add-to-cart and never types into a search field, and every other gate
 * reads HTML, status codes or the database. A shop whose search is dead renders
 * perfectly, answers 200 everywhere, and takes orders.
 *
 * The cause was one request header. The storefront asked the API in `en`, and
 * on those two shops that is not the locale their store runs on, which sent the
 * search into an almost empty translations table instead of at the products.
 * Measured on the live shop, same query, one header changed: `en` returned 0,
 * `en-AU` returned 65, and a locale invented on the spot returned 65 as well.
 *
 * That header is set per shop, at runtime, from a value read off each shop's own
 * database at deploy time. So it can drift for one shop and not the others, and
 * the drift is invisible in every existing check. This is the gate that sees it.
 *
 * ── why it searches for a word from each shop's own catalogue ───────────────
 *
 * One search term across seven shops does not work, and getting that wrong sent
 * a wrong conclusion to the client once already. A third shop was reported as
 * broken because it returned nothing for a term from another brand's range. It
 * was correct: it sells a different brand and has no product with that word in
 * it. Searched with a word out of its own catalogue it returns all eight of its
 * products.
 *
 * So the term is taken from the shop: its own first product's name supplies it,
 * read from its own home page. A shop is compared against itself and against
 * nothing else.
 *
 * ── and why a browser ──────────────────────────────────────────────────────
 *
 * These pages stream through Suspense. The first HTML response carries the
 * shell and none of the product links, so curl returns zero for a page that is
 * working perfectly. That mistake was made three times in one day on this exact
 * question before the rule was written down.
 */
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Credentials for a gated shop, from .shopauth. Never printed, only used.
 *
 * The wholesale shop shows a customer nothing until it knows who they are, so a
 * signed-out run of this gate reported "browsing returned nothing" for it and
 * would have covered six shops out of seven while looking complete. Its search
 * is the one most worth checking: it is the shop where a buyer arrives knowing
 * a part number.
 *
 * Same file and same shape script/shot_sections.mjs already reads, so there is
 * one place to put a shop's login rather than two.
 */
function credentials(shop) {
  if (!existsSync(".shopauth")) return null;
  const env = {};
  for (const line of readFileSync(".shopauth", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const key = shop.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const email = env[`${key}_EMAIL`];
  const password = env[`${key}_PASSWORD`];
  return email && password ? { email, password } : null;
}

/** Sign in, if this shop has a login on file. Returns whether it worked. */
async function signIn(page, host, creds) {
  for (const path of ["/wholesale/sign-in", "/account"]) {
    await page
      .goto(`https://${host}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      })
      .catch(() => {});
    // Same reason as below. This shop answers a redirect on its way in, so the
    // page can still be navigating when the form is looked for.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const field = await page
      .waitForSelector('input[type="email"], input[name="email"]', {
        timeout: 20000,
      })
      .catch(() => null);
    if (!field) continue;
    await page.fill('input[type="email"], input[name="email"]', creds.email);
    await page.fill(
      'input[type="password"], input[name="password"]',
      creds.password,
    );
    // The click starts a navigation, so anything asked of the page immediately
    // after it races with the context being torn down: the first version of
    // this returned "Execution context was destroyed" and that read as a
    // broken shop. Wait for the page to settle before asking it anything.
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      page.click('button[type="submit"], input[type="submit"]'),
    ]);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(4000);
    // Whether it worked is asked of the page, not assumed from the click: a
    // wrong password also leaves the form submitted.
    const stillForm = await page
      .$('input[type="password"]')
      .catch(() => null);
    if (!stillForm) return true;
  }
  return false;
}

const estate = readFileSync(".estate", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"))
  .reduce((a, c) => {
    const live = (c[7] || "").replace(/^https?:\/\//, "");
    if (live) a[c[0]] = live;
    return a;
  }, {});

const SHOPS = (process.env.SHOPS ?? Object.keys(estate).join(",")).split(",");
const browser = await chromium.launch();

/** Wait for the grid or the empty state, never for one of them alone. */
const settle = (page) =>
  page
    .waitForFunction(
      () =>
        document.querySelectorAll('a[href*="/products/"]').length > 0 ||
        /no products|no results/i.test(document.body.innerText),
      null,
      { timeout: 45000 },
    )
    .catch(() => {});

const rows = [];

for (const shop of SHOPS) {
  const host = estate[shop];
  if (!host) {
    rows.push({ shop, skip: "no live url in .estate" });
    continue;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    // Sign in first where a login is on file. A gated shop shows a signed-out
    // visitor no products at all, and that reads identically to a broken
    // search.
    const creds = credentials(shop);
    let signedIn = null;
    if (creds) {
      signedIn = await signIn(page, host, creds);
      if (!signedIn) {
        rows.push({ shop, host, note: "a login is on file for this shop and it did not work" });
        await page.close();
        continue;
      }
    }

    // A word from this shop's own catalogue, off its own listing.
    //
    // /products for every shop, the gated one included. It was
    // /wholesale/products for that shop, which returned nothing and read as a
    // broken search: the wholesale routes exist but the shop's own catalogue is
    // at the same address as everyone else's once you are signed in. Taken from
    // script/shot_sections.mjs, which has been photographing that page for
    // weeks.
    const listing = "/products";
    await page.goto(`https://${host}${listing}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await settle(page);
    const browseCount = await page.$$eval(
      'a[href*="/products/"]',
      (a) => a.length,
    );
    const firstName = await page
      .$$eval('a[href*="/products/"]', (a) =>
        a.map((x) => x.textContent.trim()).filter((t) => t.length > 3),
      )
      .then((names) => names[0] ?? "");

    if (!browseCount) {
      // Browsing itself is broken, so a search result of zero would say nothing
      // about search. Reported as its own state rather than folded in.
      rows.push({ shop, host, browseCount, term: "", searchCount: 0, note: "browsing returned nothing, search not judged" });
      await page.close();
      continue;
    }

    // The longest word in that name, which is the most distinctive thing this
    // shop is certain to have. Not a word chosen here: a term written into this
    // file would be a term from one brand, and that is the mistake above.
    const term = firstName
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length >= 4)
      .sort((a, b) => b.length - a.length)[0];

    if (!term) {
      rows.push({ shop, host, browseCount, term: "", searchCount: 0, note: `no usable word in ${JSON.stringify(firstName)}` });
      await page.close();
      continue;
    }

    await page.goto(
      `https://${host}${listing}?q=${encodeURIComponent(term)}`,
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    await settle(page);
    const searchCount = await page.$$eval(
      'a[href*="/products/"]',
      (a) => a.length,
    );
    const counter = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s+products?/i);
      return m ? Number(m[1]) : null;
    });

    rows.push({ shop, host, browseCount, term, searchCount, counter, signedIn });
    await page.close();
  } catch (e) {
    rows.push({ shop, host, error: e.message.split("\n")[0] });
    await page.close().catch(() => {});
  }
}

await browser.close();

let failed = 0;
for (const r of rows) {
  if (r.skip) {
    console.log(`      ${r.shop.padEnd(9)} skipped: ${r.skip}`);
    continue;
  }
  if (r.error) {
    failed++;
    console.log(`      ${r.shop.padEnd(9)} ERROR    ${r.error}`);
    continue;
  }
  if (r.note) {
    failed++;
    console.log(`      ${r.shop.padEnd(9)} FAIL     ${r.note}`);
    continue;
  }
  const ok = r.searchCount > 0;
  if (!ok) failed++;
  console.log(
    `      ${r.shop.padEnd(9)} ${ok ? "ok  " : "FAIL"}   browse=${String(r.browseCount).padStart(2)}  "${r.term}" -> ${String(r.searchCount).padStart(2)} card(s)${r.counter !== null && r.counter !== undefined ? `, page says ${r.counter}` : ""}${r.signedIn ? "  (signed in)" : ""}`,
  );
}

console.log();
if (failed) {
  console.log(`      ${failed} shop(s) return nothing for a word out of their own catalogue.`);
  console.log();
  console.log("      That shop renders, answers 200 and sells. Check the locale the");
  console.log("      storefront asks the API in: docker exec <shop>_storefront printenv");
  console.log("      SPREE_API_LOCALE, against that shop's own store default_locale.");
  process.exit(1);
}
console.log(`      ok — ${rows.filter((r) => !r.skip).length} shop(s), each finding its own products by name`);
