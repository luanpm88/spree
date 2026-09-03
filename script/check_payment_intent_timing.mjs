#!/usr/bin/env node
/**
 * A Stripe intent is created when the customer arrives at payment, and not when
 * the page opens.
 *
 *   node script/check_payment_intent_timing.mjs <shop> [storefront host]
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * The checkout is one long page and `PaymentSection` mounts with it, so its init
 * effect asked Spree for a payment session the moment the page rendered. For
 * Stripe that is a PaymentIntent per checkout page load, before the customer has
 * typed a character, and an abandoned checkout is the normal case.
 *
 * The shop owner found it in his own dashboard:
 *
 *   "Something is not right with Strip, every cart is making a connection with
 *    Stripe."
 *
 * 549 rows, nearly all Incomplete with no payment method. Nothing was ever
 * charged. What it cost was the dashboard: the intents belonging to real buyers
 * sat among hundreds belonging to nobody.
 *
 * ── why this measures the database and not the browser ─────────────────────
 *
 * Because the browser cannot tell the two cases apart. Stripe's script loads
 * either way: the express checkout button at the top of the page mounts Stripe
 * Elements without a client secret, so js.stripe.com traffic and even Stripe
 * iframes are present on a page that has created no intent at all. A probe that
 * watched for Stripe network calls would call this fixed while it was broken.
 *
 * `spree_payment_sessions` is one row per intent and it is the row the intent is
 * created from, so counting it before and after is the same number the shop
 * owner is looking at.
 *
 * ── the two halves, and why both are asserted ──────────────────────────────
 *
 * Opening the checkout must create nothing. Arriving at payment must create
 * exactly one, and a card field must appear. The second half is the one that
 * costs money if it breaks: a gate that never opens is a shop that renders
 * perfectly and cannot take an order, which this project has already shipped
 * once.
 *
 * ── what this probe refuses to do ──────────────────────────────────────────
 *
 * It does not scroll, click, focus or touch anything inside the payment box
 * before the first count. Those are the exact gestures that open the gate, so a
 * probe that made any of them would be arranging the state it then measured. A
 * mailer fix was reported as working on 19 Aug on the strength of a script that
 * did precisely that, and three shops shipped broken while the script called
 * them green.
 *
 * It also checks, rather than assumes, that the payment box starts below the
 * fold. On a tall enough window it would not, the observer's first callback
 * would fire immediately, and a session on page load would be correct behaviour
 * rather than the bug. In that case this says so instead of passing or failing.
 *
 * It cleans up the order it created. The owner's Draft Orders screen is where
 * this project's last round of probe litter turned up.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const shop = process.argv[2];
if (!shop) {
  console.error(
    "usage: node script/check_payment_intent_timing.mjs <shop> [storefront host]",
  );
  process.exit(2);
}

// ── the estate files, which name his shops and are gitignored ──────────────
const env = {};
if (existsSync(".estate.env")) {
  for (const line of readFileSync(".estate.env", "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const { SSH_HOST, SSH_KEY, SSH_PORT = "22" } = env;
if (!SSH_HOST || !SSH_KEY) {
  console.log("    skipped — .estate.env names no host");
  process.exit(0);
}

let host = process.argv[3];
if (!host && existsSync(".estate")) {
  for (const line of readFileSync(".estate", "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#") || line.startsWith("LIVE_DOMAINS="))
      continue;
    const c = line.split("|");
    if (c[0] !== shop) continue;
    // Prefer the live url; fall back to the review copy. "-" means the client
    // has not created that domain yet.
    const live = (c[7] || "").trim();
    const review = (c[6] || "").trim();
    const pick = live && live !== "-" ? live : review;
    if (pick && pick !== "-")
      host = pick.startsWith("http") ? pick : `https://${pick}`;
  }
}
if (!host) {
  console.log(`    skipped — no storefront host known for ${shop}`);
  process.exit(0);
}

const rsh = (cmd) =>
  execFileSync(
    "ssh",
    ["-n", "-i", SSH_KEY, "-p", SSH_PORT, "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", SSH_HOST, cmd],
    { encoding: "utf8", timeout: 120000 },
  ).trim();

const countSessions = () => {
  const out = rsh(
    `docker exec estate-postgres psql -U postgres -At -d ${shop}_shop -c "SELECT count(*) FROM spree_payment_sessions"`,
  );
  const n = Number.parseInt(out.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

let before;
try {
  before = countSessions();
} catch {
  console.log(`    skipped — could not read ${shop}'s payment sessions`);
  process.exit(0);
}
if (before === null) {
  console.log("    skipped — payment session count came back unreadable");
  process.exit(0);
}

// ── the browser ────────────────────────────────────────────────────────────
// 1440x900 is a laptop, and it is the window the payment box has to be below
// the fold in for this to be measuring anything.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const fail = async (msg) => {
  console.log(`    FAIL  ${msg}`);
  await browser.close();
  process.exit(1);
};
const skip = async (msg) => {
  console.log(`    ${msg}`);
  await browser.close();
  process.exit(0);
};

await page
  .goto(`${host}/products`, { waitUntil: "domcontentloaded", timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(6000);
const links = await page
  .evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('a[href*="/products/"]')].map((a) =>
        a.getAttribute("href"),
      ),
    ),
  ])
  .catch(() => []);
if (!links.length) await skip("no products to test with");

await page
  .goto(host + links[0], { waitUntil: "domcontentloaded", timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(6000);
const add = page
  .getByRole("button", { name: /add to (cart|basket)|add to bag/i })
  .first();
if (!(await add.count())) await skip("no add to cart button");
await add.scrollIntoViewIfNeeded().catch(() => {});
await add.click({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(8000);

await page
  .goto(`${host}/checkout`, { waitUntil: "domcontentloaded", timeout: 90000 })
  .catch(() => {});
// Long enough that a session created on mount has certainly landed. Too short a
// wait here would read as a pass for the wrong reason.
await page.waitForTimeout(15000);

// Is there a session-based method on this shop at all? Several of these shops
// run on bank transfer, which never touches a gateway, and on those there is
// nothing to time.
const geometry = await page
  .evaluate(() => {
    const box = document.getElementById("checkout-section-payment");
    if (!box) return { present: false };
    const r = box.getBoundingClientRect();
    return {
      present: true,
      top: Math.round(r.top),
      viewport: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      text: box.innerText.slice(0, 400),
    };
  })
  .catch(() => null);

if (!geometry?.present)
  await skip("no payment section on this checkout, nothing to time");

console.log(`    payment box starts ${geometry.top}px down a ${geometry.viewport}px window`);
if (geometry.scrollY !== 0)
  await fail(
    `the page was already scrolled to ${geometry.scrollY}px, so this run arranged what it measures`,
  );

const afterOpen = countSessions();

// The honest third outcome. If the box is within reach at load then the
// observer's first callback fires immediately, a session on page load is
// correct, and this run proves nothing either way rather than passing or
// failing.
//
// The threshold is the window PLUS the observer's 200px rootMargin, not the
// window. Getting this wrong is how the probe would fail a shop that is working:
// a box 950px down a 900px window is below the fold and still inside the margin,
// so it opens the gate, correctly, and a bare `top < viewport` test would call
// that a leak.
const REACH = geometry.viewport + 200;
if (geometry.top < REACH) {
  console.log(
    `    inconclusive — the payment box is within reach (${geometry.top}px < ${REACH}px) at load on`,
  );
  console.log(
    `                   this window, so a session here is expected. sessions ${before} → ${afterOpen}`,
  );
  await browser.close();
  process.exit(0);
}

if (afterOpen !== before) {
  await fail(
    `opening the checkout created ${afterOpen - before} payment session(s): ${before} → ${afterOpen}`,
  );
}
console.log(`    ok    opening the checkout created nothing (${before} → ${afterOpen})`);

// ── now arrive, the way a customer does ────────────────────────────────────
await page
  .evaluate(() => {
    document
      .getElementById("checkout-section-payment")
      ?.scrollIntoView({ block: "center" });
  })
  .catch(() => {});
await page.waitForTimeout(15000);

const afterArrive = countSessions();
const drew = await page
  .evaluate(() => {
    const frames = [...document.querySelectorAll("iframe")].map(
      (f) => f.getAttribute("src") || "",
    );
    return {
      stripeFrames: frames.filter((s) => /stripe/i.test(s)).length,
      cardWords: /card number|credit card|card details|pay with card/i.test(
        document.body.innerText,
      ),
    };
  })
  .catch(() => ({ stripeFrames: 0, cardWords: false }));

console.log(
  `    after scrolling to payment: sessions ${afterOpen} → ${afterArrive}, stripe iframes ${drew.stripeFrames}`,
);

let bad = false;
if (afterArrive <= afterOpen) {
  console.log(
    "    FAIL  arriving at the payment step created no session, so no card field can appear",
  );
  bad = true;
} else if (afterArrive - afterOpen > 1) {
  console.log(
    `    FAIL  arriving created ${afterArrive - afterOpen} sessions where one is needed`,
  );
  bad = true;
} else {
  console.log("    ok    arriving created exactly one session");
}

// A session is not a card field. Reported separately rather than rounded up,
// because check_card_field.mjs once printed the stronger finding for the weaker
// measurement and called a shop ready on it.
if (!bad && !(drew.stripeFrames > 0 || drew.cardWords)) {
  console.log(
    "    note  a session exists but no card field was detected on the page. That can be",
  );
  console.log(
    "          a gateway this shop does not draw inline; check_card_field.mjs says which.",
  );
}

// ── clean up after itself ──────────────────────────────────────────────────
// Follows check_note_box: bounded to the last 30 minutes and to the shape a
// real shopper cannot be in. Getting past `cart` is what entering an email
// does, so guest AND no email AND not `cart` AND minutes old is this probe.
try {
  const gone = rsh(
    `docker exec ${shop}_web bin/rails runner '` +
      `orders = Spree::Order.where(completed_at: nil, email: nil, user_id: nil)` +
      `.where.not(state: %q{cart}).where(%q{created_at > ?}, 30.minutes.ago); ` +
      `n = 0; orders.to_a.each { |o| id = o.id; o.destroy; n += 1 unless Spree::Order.exists?(id: id) }; ` +
      `print %q{<<C:} + n.to_s + %q{:C>>}' 2>/dev/null`,
  );
  const m = gone.match(/<<C:(\d+):C>>/);
  if (m && Number(m[1]) > 0)
    console.log(`    cleaned up ${m[1]} draft order(s) this run created`);
} catch {
  console.log(
    "    note  could not clean up the draft order this run created; remove it by hand",
  );
}

await browser.close();
process.exit(bad ? 1 : 0);
