// Walk a deployed storefront in a real browser and report what a shopper would hit.
//
//   node script/check_storefront_e2e.mjs https://shop.example.com ca
//
// ── why this exists ──────────────────────────────────────────────────────────
//
// Every other check in this repository reads HTML or asks the database. Those
// found a great deal and missed the two worst defects of the whole build:
//
//   Add to Cart did nothing. The button rendered, the page answered 200, the
//   markup was perfect. The first item any visitor added was rejected by the API
//   and the failure surfaced as an empty toast, so the shop looked finished and
//   could not take an order.
//
//   Category pages answered 200 while titling themselves "Category Not Found",
//   because the storefront runs with cacheComponents and the shell goes out
//   before notFound() runs. A status-code check calls that page healthy.
//
// So this clicks. Nothing here is inferred from markup: it opens pages, presses
// the button, and looks at what is on screen afterwards.
//
// ── keeping it honest ────────────────────────────────────────────────────────
//
// Two rules learned the hard way while writing it.
//
// Wait for content, not for the document. The storefront streams: the shell
// arrives first and the price, the title and the buttons follow. An early check
// reported a product page with no title, which is a bug in the test and the
// worst kind, because it sends you looking for a defect that is not there.
//
// "Loaded" always means "and it is not the not-found page". See above.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("playwright");

const BASE = (process.argv[2] || process.env.BASE || "").replace(/\/$/, "");
const COUNTRY = process.argv[3] || process.env.COUNTRY || "ca";
const LOCALE = process.argv[4] || process.env.LOCALE || "en";
if (!BASE) {
  console.error("usage: node script/check_storefront_e2e.mjs <https://host> [country] [locale]");
  process.exit(2);
}
const SHOP = `${BASE}/${COUNTRY}/${LOCALE}`;

let pass = 0;
const failures = [];
const ok = (n, d = "") => {
  pass++;
  console.log(`  ok    ${n}${d ? `  ${d}` : ""}`);
};
const bad = (n, d) => {
  failures.push(`${n}: ${d}`);
  console.log(`  FAIL  ${n}  ${d}`);
};
const check = (c, n, d = "") => (c ? ok(n, d) : bad(n, d || "false"));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Anything on this host that answers 4xx or 5xx while we walk. Third-party
// scripts are somebody else's server and are reported separately, not as a fault
// of the shop.
const dead = [];
page.on("response", (r) => {
  if (r.status() >= 400 && r.url().startsWith(BASE)) dead.push(`${r.status()} ${r.url()}`);
});

// domcontentloaded, never networkidle.
//
// This waited for networkidle and it is the wrong question to ask a framework
// that streams. Measured: on a shop's front page 113 requests finish and one
// stays open indefinitely, a Next RSC prefetch of the form `?_rsc=...`, so the
// network never goes idle and goto burns its full 120s before throwing.
//
// It passed for weeks, which is the worst property a wait can have. Whether the
// prefetch happens to settle depends on how busy the box is, so the gate was
// green until an afternoon of rebuilds made it red, and the first instinct was
// that the change under test had broken the shop. It had not: taking that change
// back off one shop and re-measuring showed the same two streams still open.
//
// The right wait was already here and doing the real work: the `waitFor`
// selector below. Waiting on content is the rule this file already states one
// screen up. Waiting on the network is the same mistake wearing a different hat,
// because "the network stopped" was never what any assertion needed.
const goto = async (url, waitFor) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (waitFor) {
    await page
      .locator(waitFor)
      .first()
      .waitFor({ state: "attached", timeout: 45000 })
      .catch(() => {});
  } else {
    // Nothing named to wait for, so give the stream a moment to paint. Every
    // assertion that follows a bare goto reads the title or the rendered text.
    await page.waitForTimeout(2500);
  }
};
const notFound = async () => /not found|could not be found/i.test(await page.title());

// Poll until a reading satisfies the assertion, or give up and return the last
// reading so the failure message carries a real number.
//
// This exists because removing networkidle took the floor out from under four
// assertions that had no wait of their own and had been relying on it: the
// header mark, the row count, the image count and the cart. Every one of them
// read the page once, immediately, and on a streaming storefront "immediately"
// is before the content arrives. Four shops reported an empty cart on a build
// that adds to cart perfectly well.
//
// So the wait belongs to the assertion, not to the navigation. An assertion
// that polls is also self-documenting about what it is actually waiting for,
// where networkidle waited for something none of them cared about.
const until = async (read, holds, timeout = 20000, interval = 400) => {
  const deadline = Date.now() + timeout;
  let last = await read();
  while (!holds(last) && Date.now() < deadline) {
    await page.waitForTimeout(interval);
    last = await read();
  }
  return last;
};

// ── the home page ───────────────────────────────────────────────────────────
// Waits for the mark, because the very next assertion is about the mark.
//
// This was a bare goto, which now falls back to a fixed pause, and the pause was
// not always long enough: the walk reported "header carries a mark: false" on a
// shop whose header holds 1 image and 3 spans. A gate that fails on a slow load
// is a gate people re-run until it is green, which is the same as not having it.
await goto(SHOP, "header img, header span");
check(!(await notFound()), "home page opens", await page.title());
const markCount = await until(
  () => page.locator("header img, header span").count(),
  (n) => n > 0,
);
check(markCount > 0, "header carries a mark", `${markCount} element(s)`);

const rows = await until(
  async () => (await page.locator("section h2").allInnerTexts()).filter((t) => t.trim()),
  (r) => r.length >= 3,
);
check(rows.length >= 3, "product rows present", String(rows.length));

// The home page must not print its own formatting markers either. This was only
// checked on the content pages, and the home page is where it happened: the hero
// heading was the one string not passed through the inline formatter, so three
// shops read "Welcome to **<brand>**" to every visitor.
const homeRaw = await page.locator("body").innerText();
const stars = (homeRaw.match(/\*\*/g) || []).length;
check(stars === 0, "home page shows no raw markers", `${stars} found`);

// Scroll the whole page so lazy images decide, then WAIT FOR THEM, then ask
// each one whether it actually decoded. A broken image still has a src.
//
// The wait is the part that had been borrowed. This scrolled, paused 2.5s and
// counted, and it worked because the goto above had already waited for
// networkidle, so every image was in before the scroll began. Taking that away
// left a fixed 2.5s pause holding the whole check up, and the count came back
// 52 of 56 on a shop whose 56 images all render. A number that is wrong in the
// safe direction is still a gate crying wolf, and this is the gate people read
// just before telling the client a shop is finished.
//
// So it waits for the images themselves, which is what it was always about, and
// it settles in well under a second on a warm shop instead of pausing 2.5s.
await page.evaluate(async () => {
  await new Promise((done) => {
    let y = 0;
    const t = setInterval(() => {
      window.scrollBy(0, 800);
      y += 800;
      if (y >= document.body.scrollHeight) {
        clearInterval(t);
        done();
      }
    }, 90);
  });
});
// Two conditions, and the second one matters as much as the first: the SET of
// images has to stop growing. Lazy images are created as the scroll passes them,
// so "every image is complete" is trivially true of the three that exist so far,
// and a check that stops there reported 8 of 49 on a shop where all 49 render.
let imgState = { total: 0, done: 0, prev: -1, prevDone: -1 };
imgState = await until(
  () =>
    page.evaluate(() => {
      const all = [...document.querySelectorAll("img")];
      return {
        total: all.length,
        // Genuinely loaded, not merely "complete". A broken image reports
        // complete:true with naturalWidth 0, and the count below is computed the
        // same way, so settling on "complete" then re-counting on "loaded" was a
        // race: a carousel image mid-swap satisfied the first and failed the
        // second, and the walk reported 53 of 54 on a shop whose 54 images all
        // load. Wait for the number this check actually reports.
        done: all.filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    }),
  (st) => {
    // Stable across two polls, not just non-growing once. A lazy row can add an
    // image a tick after the total first holds still.
    const settled =
      st.total > 0 &&
      st.done === st.total &&
      st.total === imgState.prev &&
      st.done === imgState.prevDone;
    imgState.prev = st.total;
    imgState.prevDone = st.done;
    return settled;
  },
  30000,
);
const imgs = await page.evaluate(() => {
  const all = [...document.querySelectorAll("img")];
  const loaded = all.filter((i) => i.complete && i.naturalWidth > 0);
  return {
    total: all.length,
    loadedCount: loaded.length,
    // Broken: the browser finished and got nothing.
    broken: all
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.currentSrc),
    // Pending: the browser has a src but has not finished. Not a fault on its
    // own — confirmed below by fetching the asset. A lazy footer image on a
    // busy box can still be in flight when everything else has settled, and
    // that image serves 200 in about a second when asked for directly.
    pending: all
      .filter((i) => !(i.complete && i.naturalWidth > 0))
      .map((i) => i.currentSrc)
      .filter(Boolean),
  };
});

// Ask the server for each pending asset rather than calling the shop broken
// because the browser was mid-fetch. This is the difference the check is
// actually about: an image element that resolves to a real asset RENDERS for a
// real visitor, whether or not this headless run happened to finish painting it.
// Measured cause: nz reported 55/56 with the one holdout being /brand/logofooter,
// which returns 200 in ~1s to a direct request, cold or warm.
const pendingBad = [];
for (const url of imgs.pending) {
  const r = await page.request.get(url).catch(() => null);
  if (!r || !r.ok()) pendingBad.push(`${r ? r.status() : "err"} ${url.slice(0, 80)}`);
}
const reallyBroken = [...imgs.broken.map((u) => `broken ${u.slice(0, 80)}`), ...pendingBad];
check(
  reallyBroken.length === 0,
  "every image renders",
  reallyBroken.length === 0
    ? `${imgs.total}/${imgs.total}`
    : `${imgs.total - reallyBroken.length}/${imgs.total}`,
);
for (const b of reallyBroken.slice(0, 3)) console.log(`        ${b}`);

// ── each row's link goes somewhere of its own, and somewhere real ───────────
//
// Any address under /c/, not only /c/collections/.
//
// This required "/collections/" in the path and failed one shop of the seven,
// whose two rows point at taxon addresses instead: /c/product-type/... and
// /c/collection-slash-design/.... Both are real, both answer 200, and both list
// products. The other six group their home page rows into collections, so the
// check read as correct for as long as there were six of them.
//
// The thing this is actually about is whether a row sends a customer somewhere of
// its own that has products on it. That is what is asserted below, and it does
// not care how the shop's owner chose to group them.
//
// Scoped to main, and that part matters. Dropping the "/collections/" filter on
// its own widened the search to every /c/ link in the document, which is the
// whole category tree carried in the menu markup: 15 addresses on that shop
// instead of its 2 rows, and it promptly failed on an empty menu category. An
// empty category somebody can reach from the menu is a fact about the client's
// catalogue. An empty page behind a HOME PAGE ROW is a fault, because the row is
// a promise the shop made.
const rowLinks = await page
  .locator('main a[href*="/c/"]')
  .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")))]);
check(rowLinks.length >= 2, "rows link somewhere of their own", rowLinks.join(" "));
// The URL is checked as well as the products, and that is the whole point.
//
// This counted a[href*="/products/"] after navigating and called any number
// above zero a pass. A category page that bounces to the HOME page passes that
// test perfectly, because the home page is full of product links. Every shop
// scored 31 of 31 for weeks while its category pages sent the customer back to
// the front door.
//
// Measured on 31 Aug, one clean request each, on an idle box:
//
//   one shop   /c/collections/on-sale  ->  the home page,  0 of 3 stayed
//   another    the same address           ->  1 of 3 stayed
//
// So the assertion is now: we are still on the address we asked for. Counting
// what is on the page cannot tell you which page you are on.
for (const href of rowLinks.slice(0, 6)) {
  const want = BASE + href;
  await goto(want, 'a[href*="/products/"]');
  const landed = page.url().replace(/\/$/, "");
  if (landed !== want.replace(/\/$/, "")) {
    bad(`row link ${href}`, `bounced to ${landed}`);
  } else if (await notFound()) {
    bad(`row link ${href}`, await page.title());
  } else {
    const n = await page.locator('a[href*="/products/"]').count();
    check(n > 0, `row link ${href}`, `${n} products`);
  }
}

// ── a product, and the thing the whole shop exists to do ────────────────────
await goto(`${SHOP}/products`, 'a[href*="/products/"]');
const first = await page.locator('a[href*="/products/"]').first().getAttribute("href");
await goto(BASE + first, "h1");
check(!(await notFound()), "product page opens", await page.title());
check((await page.locator("h1").count()) > 0, "product has a name");
// Polled, like the other four. This was the one assertion left reading the page
// once, and it duly reported "no price" on a shop where all 6 products show one,
// have an Add to Cart and read In Stock. The price streams in after the heading,
// so a single read is a coin toss on a busy box, and "this shop shows no price"
// is exactly the kind of false alarm that gets a gate ignored.
const priceText = await until(
  () => page.locator("body").innerText(),
  (t) => /\$\s?\d/.test(t),
);
check(/\$\s?\d/.test(priceText), "product shows a price");

const add = page.getByRole("button", { name: /add to (cart|bag)/i }).first();
await add.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
if (await add.count()) {
  // Visible is not clickable, and this assertion spent a day being intermittent
  // on that distinction. The button is server rendered, so it is on screen and
  // enabled well before React has attached its handler, and a click landing in
  // that window does nothing at all: no request, no error, no change on the
  // page. Then the walk reads an empty cart and calls the shop unable to sell.
  //
  // Measured rather than guessed, because "flaky" is the answer that ends an
  // investigation. Clicking the moment the button turned visible put the item
  // in the cart 1 time in 6. Adding a 2 second settle first: 5 out of 5. Same
  // build, same product, same shop.
  //
  // So the click is retried until the browser SENDS something. A click that
  // produced no request never reached the handler and is worth repeating; a
  // click that produced a request has been received, and if the cart is still
  // empty after that then the shop really cannot sell, which is what this
  // assertion is for. The two causes are no longer reported as one.
  // Retried until the CART TOKEN COOKIE exists, which is the only signal here
  // that means what it says.
  //
  // Two weaker ones were tried first and both were wrong. "The button changed to
  // a pending state" fails because it never changes: measured over 10 polls at
  // 100ms, the label is identical throughout. "The browser sent a non-GET
  // request" fails because App Router navigation POSTs on its own, so that flag
  // was already true on every run and the retry never retried.
  //
  // The cookie is unambiguous. On a first visit the storefront holds only
  // spree_country and spree_locale; a successful add adds _spree_cart_token and
  // _spree_cart_token_id. Measured on the two outcomes:
  //
  //   clicked as soon as visible   cookies after the click: country, locale
  //   clicked after a 2s settle    cookies after: + _spree_cart_token(_id)
  //
  // No token means the action never ran, so the click is worth repeating. A
  // token and an empty cart afterwards is a shop that cannot sell, which is the
  // thing this assertion exists to catch. They are no longer one failure.
  const hasToken = async () =>
    (await page.context().cookies()).some((c) => c.name.startsWith("_spree_cart_token"));
  let attempts = 0;
  while (!(await hasToken()) && attempts < 4) {
    attempts += 1;
    await add.click({ timeout: 10000 }).catch(() => {});
    for (let i = 0; i < 12 && !(await hasToken()); i++) await page.waitForTimeout(250);
  }
  if (!(await hasToken())) {
    bad("add to cart button", `clicked ${attempts}x and no cart token was ever set`);
  }
  await page.waitForTimeout(1500);
  // The line item, not the shell. The cart page streams: `main` is attached long
  // before anything is in it, so this used to read the empty state and call the
  // shop unable to sell. This is the single most important assertion in the file
  // and it was the one most exposed by a wait that was not its own.
  await goto(`${SHOP}/cart`, "main");
  const cart = await until(
    () => page.locator("body").innerText(),
    (t) => !/empty/i.test(t) && /\$\s?\d/.test(t),
  );
  check(
    !/empty/i.test(cart) && /\$\s?\d/.test(cart),
    "adding to cart puts it in the cart",
    attempts > 1 ? `took ${attempts} clicks` : "",
  );
} else {
  bad("add to cart button", "not found");
}

// ── content pages, and the formatting the client asked for ──────────────────
for (const [slug, needs] of [
  ["about", true],
  ["faq", false],
]) {
  await goto(`${SHOP}/pages/${slug}`, "section");
  if (await notFound()) {
    console.log(`  note  /pages/${slug} is not a page on this shop`);
    continue;
  }
  ok(`/pages/${slug} opens`, await page.title());
  const h1 = await page
    .locator("h1")
    .first()
    .evaluate((el) => getComputedStyle(el).color)
    .catch(() => "");
  check(h1 === "rgb(0, 0, 0)", `/pages/${slug} heading is black`, h1);
  if (needs) {
    check((await page.locator("section strong").count()) > 0, `/pages/${slug} keeps its bold`);
  }
  // No page should ever print the formatting markers themselves.
  const raw = await page.locator("body").innerText();
  check(!/\*\*\w/.test(raw), `/pages/${slug} shows no raw markers`);
}

// the FAQ opens and closes
await goto(`${SHOP}/pages/faq`, "details");
if (!(await notFound())) {
  const d = page.locator("details");
  const n = await d.count();
  check(n > 0, "faq questions", String(n));
  if (n) {
    const answer = d.first().locator("p").first();
    check(!(await answer.isVisible()), "answers start closed");
    await d.first().locator("summary").click();
    await page.waitForTimeout(400);
    check(await answer.isVisible(), "a question opens when clicked");
  }
}

// ── the addresses the shop had before this build ────────────────────────────
//
// Asserted on where the request LANDS, not on the page title.
//
// The title was checked here until a shop owner retitled his contact page to a
// heading with no "contact" in it, which failed a gate that was working
// correctly. A page title is his copy: he edits it in the content module
// whenever he likes, and a gate that fails when he rewords a heading is a gate
// people learn to ignore. Where the old address lands is the thing this is
// actually about, and that is ours, not his.
//
// The returns policy is taken from the shop's own footer rather than named here.
//
// It was hardcoded as /policies/returns, which is the address six of the seven
// shops carry over from the Rails storefront they are being migrated off. The
// seventh does not have it and should not: it is already on Next, its policy
// slugs end in -policy, and its footer links to the -policy one.
//
// Checked against the client's own live site before changing anything here,
// because a gate that disagrees with the shop it describes is usually right. His
// live site renders "404 This page could not be found." at the bare address too,
// and renders the -policy one. So the gate was asserting six shops' history on a
// shop that has none of it. Had his own site rendered that page, the finding
// would have been real and the gate right.
const footerReturns = await page
  .locator('footer a[href*="/policies/"]')
  .evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")).find((h) => /return|refund/i.test(h || "")),
  );

for (const [legacy, destination] of [
  ["/contact-us", "/contact"],
  ["/pages/faq", "/pages/faq"],
  // Stripped back to the unprefixed address, because that is the whole point of
  // this block: the old address arrives with no country and no locale on it, and
  // the middleware is what has to put them back.
  ...(footerReturns
    ? [[footerReturns.replace(BASE, "").replace(`/${COUNTRY}/${LOCALE}`, ""), "/policies/"]]
    : []),
]) {
  await goto(BASE + legacy, "main");
  const landed = page.url();
  check(
    !(await notFound()) && landed.includes(destination),
    `old address ${legacy}`,
    landed.replace(BASE, "") || landed,
  );
}

// ── a review copy must not be indexable ────────────────────────────────────
//
// Six of the seven review hosts were serving `Allow: /`, no noindex anywhere,
// and a canonical tag naming themselves, for nine days. So Google was free to
// index six copies of shops that are live elsewhere, each one asserting it was
// the original. Nothing in this walk would have noticed, because every page
// answered 200 and looked perfect, which is the same shape as the fault this
// whole file was written for.
//
// Keyed on the hostname, the same rule shop_host's own guard uses: a name
// starting with `new` is a temporary copy. On cutover day the shop answers to
// its real name, this check stops applying to it, and `shop_host indexable`
// removes the header. So the check does not have to be remembered or removed.
//
// The header, not robots.txt. `Disallow: /` stops crawling and not indexing: a
// URL can be indexed from an external link without ever being fetched, and once
// it is in, the Disallow stops the crawler fetching the page to discover the
// noindex, so the entry stays. X-Robots-Tag is the control that actually
// removes it, and it only works if the crawler is let in to read it.
{
  const host = new URL(BASE).hostname;
  const isReviewCopy = host.startsWith("new") || host.endsWith(".local");
  if (isReviewCopy) {
    // Asked of the shop's front page and of its sitemap, because the sitemap is
    // served by a different nginx block and nginx drops an inherited add_header
    // in any location that declares one of its own. One of the two passing is
    // not this check passing.
    for (const path of [`/${COUNTRY}/${LOCALE}`, "/sitemap.xml"]) {
      const r = await page.request.get(BASE + path, { maxRedirects: 0 }).catch(() => null);
      const tag = r ? r.headers()["x-robots-tag"] || "" : "";
      check(
        /noindex/i.test(tag),
        `review copy is not indexable: ${path}`,
        tag || "no X-Robots-Tag header",
      );
    }
  } else {
    ok("live hostname, indexability is not this check's business", host);
  }
}

// ── the sitemap has to PARSE, not merely answer ─────────────────────────────
//
// The client found this one, and he found it by reading the file. Every check
// here had asked whether the sitemap answers, what its headers say and how big
// it is. None of them had ever asked whether it is XML.
//
// It was not. Three of his product photographs are named with an "&" in them,
// ActiveStorage keeps the original filename in the URL path, and a bare "&"
// inside <image:loc> rejects the entire document:
//
//     not well-formed (invalid token): line 114, column 199
//
// 200, right content type, 76 KB, and worth nothing to a crawler. On every shop.
//
// Parsed with the browser's own DOMParser rather than a regex, because "is this
// well formed XML" is exactly the question a real parser exists to answer, and a
// regex that approximates it would have passed the document that shipped.
{
  const sitemaps = ["/sitemap.xml"];
  // The index names its chunks, so follow them: the fault was in a chunk, not in
  // the index, and checking only the index is how it survived.
  const index = await page.request.get(`${BASE}/sitemap.xml`).catch(() => null);
  if (index?.ok()) {
    const body = await index.text();
    for (const m of body.matchAll(/<loc>([^<]*sitemap\/[^<]*)<\/loc>/g)) {
      try {
        sitemaps.push(new URL(m[1]).pathname);
      } catch {
        // A <loc> that is not a URL is its own failure, reported below when the
        // document is parsed.
      }
    }
  }

  for (const path of [...new Set(sitemaps)]) {
    const r = await page.request.get(BASE + path).catch(() => null);
    if (!r?.ok()) {
      bad(`sitemap ${path} is XML`, r ? `HTTP ${r.status()}` : "no response");
      continue;
    }
    const xml = await r.text();
    const verdict = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, "application/xml");
      const err = doc.querySelector("parsererror");
      if (err) return err.textContent?.replace(/\s+/g, " ").slice(0, 140) || "parse error";
      return null;
    }, xml);
    check(verdict === null, `sitemap ${path} is XML`, verdict || `${xml.length} bytes`);
  }
}

// ── nothing on this host failed while we walked it ──────────────────────────
check(dead.length === 0, "no request to this shop errored", [...new Set(dead)].slice(0, 3).join(" | "));

await browser.close();
console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`    - ${f}`);
  process.exit(1);
}
