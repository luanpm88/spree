#!/usr/bin/env node
/**
 * The policy pages, on every shop, in a browser.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * While tracing why search returned nothing on two shops, the same cause turned
 * out to have a second and worse symptom. Measured on the live shops:
 *
 *   GET /api/v3/store/policies   no locale header   200 on all seven
 *   GET /api/v3/store/policies   x-spree-locale: en 500 on two of them
 *   GET /api/v3/store/policies   the shop's locale  200 on all seven
 *
 * The backend raises PG::InvalidColumnReference, "for SELECT DISTINCT, ORDER BY
 * expressions must appear in select list": the translation join adds an
 * ordering column that is not in the DISTINCT select list.
 *
 * The footer's list of policies survives that because getPolicies builds its
 * own fetch and sends no locale header at all. The single policy fetch does go
 * through the SDK, with the locale, and cachedGetPolicy rethrows anything that
 * is not a 404. So the pages themselves are the exposed path, and they are in
 * his footer on every page of two live shops.
 *
 * ── what it measures, and why not curl ─────────────────────────────────────
 *
 * The policy names are read from each shop's own footer rather than guessed:
 * slugs are store data, they differ between shops, and a list written here
 * would be the same guess that once put two dead links in the footer.
 *
 * These pages stream, and the storefront answers 200 with a static shell before
 * the dynamic part fails, so a status code proves nothing at all. What counts is
 * whether the body ends up carrying the policy or an error, which only a browser
 * that waits can tell you.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "tmp/annotated/policies";
mkdirSync(OUT, { recursive: true });

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

for (const shop of SHOPS) {
  const host = estate[shop];
  if (!host) {
    console.log(`\n${shop}: not in .estate`);
    continue;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

  await page.goto(`https://${host}/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // Wait for the footer to actually arrive.
  //
  // Without this the first version of this file reported "0 policy links in the
  // footer" on one shop and four on every other, and that nearly went out as a
  // finding about a shop with no privacy policy link. The footer streams in
  // after domcontentloaded; the other shops had simply got there first. The
  // shop was fine and the measurement was not, which is the third time today
  // the same mistake has been made in the same direction.
  await page
    .waitForFunction(
      () => document.querySelectorAll('footer a[href*="/policies/"]').length > 0,
      null,
      { timeout: 30000 },
    )
    .catch(() => {});

  // The shop's own policy links, out of its own footer.
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/policies/"]')]
      .map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim() }))
      .filter((l, i, arr) => arr.findIndex((x) => x.href === l.href) === i),
  );
  console.log(`\n── ${shop} · ${host} · ${links.length} policy link(s) in the footer`);

  for (const link of links) {
    const url = new URL(link.href, `https://${host}`).toString();
    errors.length = 0;
    let status = 0;
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p2.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    const resp = await p2
      .goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => null);
    status = resp ? resp.status() : 0;
    // Wait for the body to settle: either real prose arrives, or the failure
    // does. Waiting only for prose would time out on a broken page and the
    // timeout would then be reported as the finding.
    await p2
      .waitForFunction(
        () => {
          const t = document.body.innerText;
          return (
            t.length > 900 ||
            /went wrong|error|not found|try again|unavailable/i.test(t)
          );
        },
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
    const body = await p2.evaluate(() => document.body.innerText);
    const h1 = await p2.$eval("h1", (e) => e.innerText).catch(() => "(no h1)");
    // Matched on the FIRST 200 characters, not the whole body.
    //
    // The first version tested the whole page and flagged two perfectly good
    // policy pages as broken, because a Terms of Service and a Returns Policy
    // both contain the ordinary English words this pattern looks for. 12,543
    // characters of real prose reported as a failure.
    //
    // A framework error page says so at the top and carries almost nothing
    // else, so the opening of the body is where the distinction actually lives.
    const broken =
      /went wrong|application error|internal server error|this page could not be found/i.test(
        body.slice(0, 200),
      );
    const chars = body.replace(/\s+/g, " ").length;
    const verdict = broken ? "BROKEN" : chars > 900 ? "ok" : "THIN";
    console.log(
      `  ${verdict.padEnd(6)} ${status}  ${String(chars).padStart(6)} chars  ${link.text.slice(0, 26).padEnd(26)} ${link.href}`,
    );
    if (broken || chars <= 900) {
      console.log(`         h1=${JSON.stringify(h1)}`);
      console.log(
        `         body=${JSON.stringify(body.replace(/\s+/g, " ").slice(0, 220))}`,
      );
      await p2.screenshot({
        path: `${OUT}/${shop}-${link.href.split("/").pop()}.png`,
      });
    }
    if (errors.length) console.log(`         pageerror: ${errors[0]}`);
    await p2.close();
  }
  await page.close();
}

await browser.close();
