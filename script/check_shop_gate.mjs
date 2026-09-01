#!/usr/bin/env node
/**
 * Prove that a closed shop is closed, against the running site.
 *
 *   node script/check_shop_gate.mjs https://<host> <country> [locale]
 *
 * ── why this exists ──────────────────────────────────────────────────────────
 *
 * The client's requirement for the wholesale shop is one sentence:
 *
 *   "No URL should be able to be seen without first login in. If a user sends a
 *    URL to a friend, they should not be allowed to see it until they have an
 *    account."
 *
 * Nothing verified that. Worse, the check that did run made the wrong outcome
 * look right: check_storefront_e2e.mjs walks the shop as a visitor with no
 * account, so on a correctly gated shop it fails at the first page. A green
 * check_all was therefore evidence the gate was OFF, and the obvious way to get
 * check_all green again is to turn the gate off.
 *
 * So this asserts the opposite of that walk, and check_all runs whichever of
 * the two matches the shop.
 *
 * ── what it asserts ──────────────────────────────────────────────────────────
 *
 * Every request below is made with NO cookies at all, which is the position the
 * friend holding the forwarded link is in.
 *
 *   the home page, a category, a product, and a product whose slug has a dot
 *     must not return the page. A dot is the one that was actually broken: the
 *     middleware matcher excluded every address containing one, so a slug like
 *     1.5l-drum rendered in full.
 *
 *   robots.txt must disallow everything, and must not name a sitemap
 *   sitemap.xml must list no URL of the shop
 *     a crawler never signs in. A shop that hands it the list of every address
 *     has published exactly what the requirement forbids, and published it
 *     somewhere that keeps the copy after the file is corrected.
 *
 *   the four policies he named must be readable
 *   the sign-in and sign-up pages must be readable
 *     "These pages are needed when a new business signs up for an account." A
 *     gate that closes its own front door is not a stricter gate, it is a shop
 *     nobody can join.
 *
 * ── redirect, not 404 ────────────────────────────────────────────────────────
 *
 * A gated address answers 307 to the login. That is checked rather than "not
 * 200", because a 404 would also pass "not 200" and would mean something quite
 * different: the page missing rather than the page withheld.
 */

const [, , rawHost, country, locale = "en"] = process.argv;

if (!rawHost || !country) {
  console.error("usage: check_shop_gate.mjs https://<host> <country> [locale]");
  process.exit(2);
}

const host = rawHost.replace(/\/$/, "");

/**
 * Ask the shop which shape its addresses have, rather than being told.
 *
 * A shop on clean URLs serves every page without the /{country}/{locale}
 * prefix, so every path below has to be built the other way. Told by a flag,
 * this check would be run with the wrong flag on the day it matters; asked of
 * the shop, it cannot be.
 *
 * The probe is one of the four policies he named, because it is the only kind of
 * address that answers 200 to a stranger on a closed shop. Unprefixed:
 *
 *   200  clean URLs. The page resolved without a prefix.
 *   3xx  prefixed. The middleware is redirecting it to the prefixed form.
 *
 * That is a positive test with no ambiguity, which "is it not a 307" would not
 * have been: on a closed shop nearly everything is a 307.
 */
async function detectBase() {
  const probe = "/policies/privacy-policy";
  const response = await fetch(`${host}${probe}`, {
    redirect: "manual",
    headers: { "user-agent": "check_shop_gate" },
  });
  return response.status === 200 ? "" : `/${country}/${locale}`;
}

const base = await detectBase();

const RED = "[31m";
const GREEN = "[32m";
const DIM = "[2m";
const OFF = "[0m";

let failed = 0;
let passed = 0;

/** No cookies, no redirect following: exactly what the middleware answered. */
async function raw(path) {
  const response = await fetch(`${host}${path}`, {
    redirect: "manual",
    headers: { "user-agent": "check_shop_gate" },
  });
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    body: response.status === 200 ? await response.text() : "",
  };
}

function ok(what) {
  passed += 1;
  console.log(`  ${GREEN}ok${OFF}    ${what}`);
}

function bad(what, detail) {
  failed += 1;
  console.log(`  ${RED}FAIL${OFF}  ${what}`);
  console.log(`        ${DIM}${detail}${OFF}`);
}

async function mustBeClosed(path, why) {
  const { status, location } = await raw(path);
  const bounced = status >= 300 && status < 400 && location.includes("/account");

  if (bounced) return ok(`closed: ${path}`);
  if (status === 404) {
    return bad(
      `closed: ${path}`,
      `404, so it is missing rather than withheld. ${why}`,
    );
  }
  bad(`closed: ${path}`, `answered ${status} to a visitor with no account. ${why}`);
}

async function mustBeOpen(path, why) {
  const { status, location } = await raw(path);
  if (status === 200) return ok(`open:   ${path}`);
  bad(
    `open:   ${path}`,
    `answered ${status}${location ? ` to ${location}` : ""}. ${why}`,
  );
}

const CLOSED = [
  // `base || "/"` because on a clean-URL shop base is empty, and this line
  // printed "closed: " with nothing after it. A check whose name is blank is a
  // check nobody can act on when it goes red.
  [base || "/", "the home page is a URL like any other"],
  [`${base}/products`, "the product index lists what the shop sells"],
  [`${base}/products/1.5l-drum`, "a slug with a dot in it: the matcher used to let every one of these through"],
  [`${base}/c/bottles`, "a category page"],
  [`${base}/cart`, "the cart"],
  [`${base}/pages/ordering-guide`, "a content page"],
];

const OPEN = [
  [`${base}/account`, "the sign-in page, or nobody can get in"],
  [`${base}/account/register`, "a new business has to be able to apply"],
  [`${base}/policies/terms-of-service`, "one of the four he named"],
  [`${base}/policies/privacy-policy`, "one of the four he named"],
  [`${base}/policies/returns-policy`, "one of the four he named"],
  [`${base}/policies/shipping-policy`, "one of the four he named"],
];

console.log(`\n  the closed shop at ${host}, as someone with no account\n`);

for (const [path, why] of CLOSED) await mustBeClosed(path, why);
for (const [path, why] of OPEN) await mustBeOpen(path, why);

// The sign-in page has to work, and a page that renders without its own logo is
// not working. This asks for every image that page references, which is how the
// gate came to serve a 307 for /brand/logo.png and still pass fourteen checks:
// every one of them asked for a page, and none for an asset.
{
  const { status, body } = await raw(`${base}/account`);
  const assets = status === 200 ? [...new Set(body.match(/\/brand\/[A-Za-z0-9._-]+/g) || [])] : [];

  if (assets.length === 0) {
    console.log(`  ${DIM}      the sign-in page references no /brand asset, nothing to check${OFF}`);
  } else {
    let broken = 0;
    for (const asset of assets) {
      const res = await raw(asset);
      if (res.status !== 200) {
        bad(`asset:  ${asset}`, `answered ${res.status}, so the sign-in page renders without it`);
        broken += 1;
      }
    }
    if (broken === 0) ok(`the sign-in page's own ${assets.length} image(s) load`);
  }
}

// He asked on 20 Aug for the footer to come off the sign-in page. The reason it
// matters beyond the look: that footer repeated the category tree, so a stranger
// could read the whole catalogue underneath a form asking them to sign in. This
// checks the rendered page, not the component tree, because the unit test passes
// whether or not the build that is serving traffic contains the change.
{
  const { status, body } = await raw(`${base}/account`);
  if (status !== 200) {
    bad("sign-in page", `answered ${status}, so nothing about it could be checked`);
  } else {
    const hasFooter = /<footer[\s>]/i.test(body);
    // The four policies are the footer's own links and appear nowhere else on
    // the sign-in page, so they are the tell that survives class name churn.
    const policyLinks = (body.match(/\/policies\/[a-z-]+/g) || []).length;
    if (hasFooter) {
      bad("sign-in page", "still renders a <footer>, which he asked to have hidden");
    } else if (policyLinks > 0) {
      bad("sign-in page", `no <footer>, but still prints ${policyLinks} policy link(s) from it`);
    } else {
      ok("the sign-in page ends at the form: no footer, no category links");
    }
  }
}

// robots.txt: a crawler never signs in.
{
  const { status, body } = await raw("/robots.txt");
  if (status !== 200) {
    bad("robots.txt", `answered ${status}; it should exist and forbid everything`);
  } else if (!/^\s*disallow:\s*\/\s*$/im.test(body)) {
    bad("robots.txt", "does not disallow / for every agent, so the shop invites indexing");
  } else if (/sitemap:/i.test(body)) {
    bad("robots.txt", "names a sitemap, which is the list of every address it must not publish");
  } else {
    ok("robots.txt forbids everything and names no sitemap");
  }
}

// The sitemap must describe nothing.
{
  const { status, body } = await raw("/sitemap.xml");
  const urls = (body.match(/<loc>/g) || []).length;
  if (status === 404) {
    ok("sitemap.xml does not exist");
  } else if (status === 200 && urls === 0) {
    ok("sitemap.xml lists no address");
  } else {
    bad("sitemap.xml", `answered ${status} listing ${urls} address(es) of a shop nobody may browse`);
  }
}

console.log("");
if (failed === 0) {
  console.log(`  ${GREEN}ok${OFF} — ${passed} check(s): the shop is closed, and open where he asked\n`);
  process.exit(0);
}
console.log(`  ${RED}${failed} of ${failed + passed} check(s) failed${OFF}\n`);
process.exit(1);
