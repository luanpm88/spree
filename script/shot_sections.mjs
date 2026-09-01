// Photograph a shop screen by screen, signing in first when it is a closed one.
//
//   node script/shot_sections.mjs <base> <shop> <locale> [outdir]
//
// Credentials, when the shop is gated, come from .shopauth (gitignored):
//
//   B2B_EMAIL=...
//   B2B_PASSWORD=...
//
// ── why this exists ──────────────────────────────────────────────────────────
//
// On 20 Aug the client sent nine annotated screenshots of the wholesale shop,
// each his page beside ours, and every fault in them was visible at a glance:
// a column of black text on a black ground, a link to a page that shop does not
// have, a policy list in the wrong order, a downloads page with no buttons.
//
// None of our checks had caught any of it, and the reason was not subtle. The
// checks read HTML and status codes, and script/shot_shop.mjs could not sign in,
// so on a shop that requires an account it photographed the sign-in page and
// stopped. Everything behind the login went unlooked-at for a week, while a test
// account for it sat in tracker task 13 from the 13th.
//
// So this signs in, then photographs each page whole AND each named section on
// its own, because a full-page shot of a long page is not something you can put
// beside his crop of one column.
//
// ── what it will not do ──────────────────────────────────────────────────────
//
// It does not judge. It produces pictures and a table, and a person compares
// them with his. An automated pixel diff against his screenshots would be
// comparing our render against a photograph of a different frontend at a
// different width, which is a number that would look like proof and mean
// nothing.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("playwright");

const BASE = (process.argv[2] || "").replace(/\/$/, "");
const SHOP = process.argv[3] || "";
const LOCALE = process.argv[4] || "en";
const OUT = process.argv[5] || join(ROOT, "tmp/client/shots", SHOP);

if (!BASE || !SHOP) {
  console.error("usage: node script/shot_sections.mjs <base> <shop> <locale> [outdir]");
  process.exit(2);
}

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", off: "\x1b[0m" }
  : { dim: "", red: "", green: "", yellow: "", off: "" };

/** Credentials for a gated shop. Never printed, only used. */
async function credentials() {
  const file = join(ROOT, ".shopauth");
  if (!existsSync(file)) return null;
  const env = {};
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const key = SHOP.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const email = env[`${key}_EMAIL`];
  const password = env[`${key}_PASSWORD`];
  return email && password ? { email, password } : null;
}

// The pages he has photographed, plus the ones a wholesale customer actually
// uses. Sections are named so a shot can be put beside his crop of the same
// thing rather than beside a whole page.
const PAGES = [
  { slug: "", name: "home", sections: ["header", "hero", "rows", "about", "enquiry", "footer"] },
  // The four business pages he sent on 25 August. Whole page each, because the
  // thing to read is whether the groups he drew are in the order he drew them,
  // which a crop of one section cannot show.
  { slug: "/pages/custom-branding", name: "custom-branding", sections: ["body"] },
  { slug: "/pages/custom-manufacturing", name: "custom-manufacturing", sections: ["body"] },
  { slug: "/pages/product-sourcing", name: "product-sourcing", sections: ["body"] },
  { slug: "/pages/track-your-order", name: "track-your-order", sections: ["body"] },
  // Where all six "Request a Quote" buttons land, with his own form inside it.
  { slug: "/pages/request-a-quote", name: "request-a-quote", sections: ["body"] },
  { slug: "/pages/resources", name: "resources", sections: ["downloads", "footer"] },
  { slug: "/pages/ordering-guide", name: "ordering-guide", sections: ["body", "footer"] },
  { slug: "/pages/brand-assets", name: "brand-assets", sections: ["body", "footer"] },
  { slug: "/pages/book-a-meeting", name: "book-a-meeting", sections: ["body", "calendar", "footer"] },
  { slug: "/account", name: "account", sections: ["form"] },
  { slug: "/products", name: "products", sections: ["grid", "footer"] },
];

// Where each named section is, resolved by what it CONTAINS rather than by its
// position.
//
// This map used to be positional: about was `main section:nth-of-type(3)`. That
// is the third section on a shop with one product row and the wrong one on a
// shop with two, and the wholesale shop has two. So every about shot taken for
// this client photographed a product row instead of the panel, silently, and it
// was only caught by putting the picture beside his and seeing two different
// things. A positional selector cannot be checked by reading it.
//
// The header, footer and iframe stay as tags, because those are unambiguous.
const SECTION_AT = {
  header: "header",
  footer: "footer",
  form: "main form",
  body: "main",
  grid: "main",
  calendar: "main iframe",
  downloads: "main ul:has(a[href$='.pdf']), main ul.divide-y",
};

/**
 * Resolve the home page's own sections by their content.
 *
 * Returns a document-space rect for the named section, or null when this shop
 * does not have one. A shop with no enquiry block gets a row saying so rather
 * than a picture of whatever happened to be third.
 */
async function homeSectionRect(page, name) {
  return page.evaluate((wanted) => {
    const secs = [...document.querySelectorAll("main > section")];
    const productLinks = (s) => s.querySelectorAll('a[href*="/products/"]').length;
    const rect = (s) => {
      const r = s.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.left + window.scrollX)),
        y: Math.max(0, Math.floor(r.top + window.scrollY)),
        width: Math.ceil(r.width),
        height: Math.ceil(r.height),
      };
    };
    if (!secs.length) return null;
    const rows = secs.filter((s) => productLinks(s) > 1);
    if (wanted === "hero") return rect(secs[0]);
    if (wanted === "rows") return rows.length ? rect(rows[0]) : null;
    if (wanted === "enquiry") return rect(secs[secs.length - 1]);
    if (wanted === "about") {
      // The panel: a section with a heading and a picture, carrying no product
      // links, and not the hero. On this client's shops it is the only one.
      const found = secs.find(
        (s, i) =>
          i > 0 &&
          productLinks(s) === 0 &&
          s.querySelector("h1,h2,h3") &&
          s.querySelector("img"),
      );
      return found ? rect(found) : null;
    }
    return null;
  }, name);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const creds = await credentials();

  const browser = await chromium.launch();
  // The shop's own time zone, so a third party widget prints the hour its
  // customers will see. His booking calendar reads the BROWSER's zone, and the
  // shot of his New Zealand wholesale page came out reading "Saigon (06:17 PM)"
  // because that is where this machine is. Nothing on the page is wrong; the
  // photograph was of the wrong viewer.
  //
  // This is presentation, not measurement, and the line between them matters
  // here: the DOM probes stay on the machine's own zone so nothing is quietly
  // arranged before being measured. Only the pictures he looks at get this.
  const TZ_BY_SHOP = {
    b2b: "Pacific/Auckland",
    nz: "Pacific/Auckland",
    au: "Australia/Sydney",
    ca: "America/Toronto",
    us: "America/New_York",
  };
  const timezoneId = TZ_BY_SHOP[SHOP];
  if (timezoneId) console.log(`  ${C.dim}clock  ${timezoneId}${C.off}`);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ...(timezoneId ? { timezoneId } : {}),
  });
  const page = await context.newPage();
  const rows = [];

  // Only this shop's own failures. A third party's 404 is their business, and
  // mixing the two is how a real one gets lost in the noise.
  const ownFailures = [];
  const host = new URL(BASE).host;
  page.on("response", (r) => {
    if (r.status() >= 400 && new URL(r.url()).host === host) {
      ownFailures.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });

  // The sign-in page has to be photographed BEFORE signing in, which is obvious
  // in hindsight and was not: the first run of this signed in and then asked for
  // /account, which by then is the account screen. The one page he annotated on
  // 20 Aug was the one page this could never capture.
  if (creds) {
    // domcontentloaded then a settle, not networkidle. The comment further down
    // already says networkidle never fires on the account page because it holds
    // a connection open, and this was the one call that had not been changed, so
    // the whole run died here on a page that answers 200 in 1.2 seconds.
    await page.goto(`${BASE}/${SHOP}/${LOCALE}/account`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const out = path.join(OUT, "signed-out--sign-in.png");
    await page.screenshot({ path: out, fullPage: true });
    rows.push({ page: "sign-in", section: "signed out", file: path.basename(out), note: "" });
    const form = page.locator("main form").first();
    if ((await form.count()) > 0) {
      const f = path.join(OUT, "signed-out--sign-in-form.png");
      await form.screenshot({ path: f });
      rows.push({ page: "sign-in", section: "form", file: path.basename(f), note: "" });
    }
  }

  // Sign in, so every page after this is what a wholesale customer sees.
  let signedIn = false;
  if (creds) {
    const url = `${BASE}/${SHOP}/${LOCALE}/account`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.fill('input[type="email"], input[name="email"]', creds.email);
    await page.fill('input[type="password"], input[name="password"]', creds.password);
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);
    // Proved, not assumed: the sign-in form must be gone from the page we land
    // on. A failed login re-renders the same form with an error, and a script
    // that carries on from there photographs the login screen six times and
    // calls it a shop.
    signedIn = (await page.locator('input[type="password"]').count()) === 0;
    console.log(
      signedIn
        ? `  ${C.green}ok${C.off}    signed in as the test account`
        : `  ${C.red}FAIL${C.off}  sign in did not take, everything below is the signed-out view`,
    );
  } else {
    console.log(`  ${C.yellow}note${C.off}  no credentials in .shopauth, shooting as a visitor`);
  }

  for (const p of PAGES) {
    const url = `${BASE}/${SHOP}/${LOCALE}${p.slug}`;
    let status = 0;
    try {
      // domcontentloaded then a settle, not networkidle. A signed-in account
      // page holds a connection open and networkidle never fires, so the shot
      // of the one page he annotated came back as "did not load" while the page
      // was serving perfectly. A proof tool that cries wolf is worse than none.
      const res = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      status = res?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    } catch {
      rows.push({ page: p.name, section: "-", file: "-", note: "did not load" });
      console.log(`  ${C.red}FAIL${C.off}  ${p.name}: did not load`);
      continue;
    }

    // A 200 is not proof the page exists, and here that is by design rather than
    // by accident: the storefront runs with cacheComponents, so the shell goes
    // out with a 200 before notFound() can change it. Every missing page on this
    // site therefore answers 200 with a 404 body. It is written up in
    // pages/[slug]/page.tsx.
    //
    // So read the page. The first attempt at this searched the first 400
    // characters and found nothing, because the marker sits far below the header
    // and the navigation. Searching the whole text for a loose "not found" would
    // then fire on any FAQ answer containing the words, so it matches the
    // heading Next actually renders instead.
    const body = await page.locator("body").innerText().catch(() => "");
    const soft404 = /this page could not be found/i.test(body);

    // Requests this shop made that failed. A broken link is invisible in a
    // screenshot and invisible in the markup, because the markup is a perfectly
    // well formed anchor: what is wrong is where it points. The footer's Login
    // link pointed at a route that does not exist on any of the six shops, and
    // the only sign of it anywhere was a 404 in the network log behind Next's
    // prefetch.
    const failed = ownFailures.splice(0);
    if (failed.length) {
      for (const f of failed) {
        rows.push({ page: p.name, section: "request", file: "-", note: f });
        console.log(`  ${C.red}FAIL${C.off}  ${p.name}: ${f}`);
      }
    }

    // Wake anything deferred before photographing. A lazily loaded iframe is not
    // loaded until it is near the viewport, and a fullPage screenshot does not
    // count as looking at it, so his booking calendar photographed as an empty
    // bordered box on a page that works perfectly. Sending that picture would
    // have had him report a fault that is not there, which is worse than sending
    // nothing.
    const frames = page.locator("iframe");
    const frameCount = await frames.count();
    for (let i = 0; i < frameCount; i++) {
      await frames.nth(i).scrollIntoViewIfNeeded().catch(() => {});
      // Wait for the frame to have PAINTED, not for a number of seconds. The
      // fixed 2500 above was enough on one run and not on the next: his booking
      // calendar came back as a blank white page, 30 kB against the 308 kB the
      // same crop weighed an hour earlier, and the table still said ok. A shot
      // that is empty because we did not wait long enough is indistinguishable
      // from a page that is broken, and this one was about to be sent to him as
      // proof the calendar works.
      // WORDS in the frame, not merely an element in it.
      //
      // This waited for the first child of <body> to attach, which happens the
      // moment the framed page's shell HTML is parsed and long before its app
      // has drawn anything. The booking calendar is a React app that fetches
      // about forty script chunks, and the shot went to the client showing a
      // 1472 x 800 empty box where his calendar should be. The frame HAD
      // painted by this check's definition, so nothing failed and nothing said
      // so, which is worse than a red line.
      const frame = frames.nth(i).contentFrame();
      // Read the length, do not pattern match it. The first attempt asked for a
      // run of 20 non-space characters, which his quotation form does not have:
      // its text is short field labels separated by spaces, so a form that had
      // drawn perfectly was reported as blank.
      let painted = false;
      for (let tries = 0; tries < 60 && !painted; tries += 1) {
        painted = await frame
          .locator("body")
          .evaluate((b) => (b.innerText || "").trim().length > 40)
          .catch(() => false);
        if (!painted) await page.waitForTimeout(500);
      }
      if (!painted) {
        rows.push({ page: p.name, section: "iframe", file: "-", note: `frame ${i} never painted` });
        console.log(`  ${C.red}FAIL${C.off}  ${p.name}: iframe ${i} drew no text, its shot will be blank`);
      }
      // And a beat after the words appear, so a widget that lays itself out in
      // two passes is photographed after the second one.
      await page.waitForTimeout(2500);

      // A shot of the frame ITSELF, because the full page one cannot show it.
      //
      // Chromium runs a cross origin iframe in its own process, and a fullPage
      // screenshot resizes the viewport and re composites: the out of process
      // frame does not paint into that capture and comes out as an empty box.
      // His booking calendar and his quotation form are both cross origin, so
      // both pages photographed as a large white rectangle where the widget is,
      // and one of those pictures was about to go to him as proof the page was
      // finished. Proved by taking an element shot of the same frame in the
      // same session, which paints it in full.
      if (painted) {
        const framed = path.join(OUT, `${p.name}--embed-${i}.png`);
        await frames.nth(i).scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(800);
        await frames
          .nth(i)
          .screenshot({ path: framed })
          .then(() => {
            rows.push({ page: p.name, section: `embed ${i}`, file: path.basename(framed), note: "the frame itself, which the full page shot cannot paint" });
            console.log(`  ${C.green}ok${C.off}    ${p.name}: embed ${i} photographed on its own`);
          })
          .catch((e) => {
            console.log(`  ${C.red}FAIL${C.off}  ${p.name}: embed ${i} would not photograph, ${e.message.split("\n")[0]}`);
          });
      }
    }
    if (frameCount > 0) await page.evaluate(() => window.scrollTo(0, 0));



    const whole = path.join(OUT, `${p.name}--full.png`);
    await page.screenshot({ path: whole, fullPage: true });
    rows.push({
      page: p.name,
      section: "full page",
      file: path.basename(whole),
      note: soft404 ? `${status} but the body says Not Found` : String(status),
    });

    for (const name of p.sections) {
      const sel = SECTION_AT[name];
      // A named home page section is found by what it holds; everything else by
      // its tag. `el` stays defined either way, because the blank fallback below
      // needs something to re-photograph.
      // The header shot runs from the very top of the document to the bottom of
      // <header>, so it contains the announcement bar as well.
      //
      // The bar is a SIBLING above <header>, not inside it, so a crop of the
      // header element alone left it out. Put beside his half, which does show
      // his black bar, the picture told him our bar was missing. It is not
      // missing; it has been on the page all day. A comparison image that
      // invites the wrong conclusion is worse than no image, because he writes
      // it on a list and we spend Monday disproving our own screenshot.
      const contentRect =
        name === "header"
          ? await page
              .locator("header")
              .first()
              .evaluate((node) => {
                const r = node.getBoundingClientRect();
                return {
                  x: 0,
                  y: 0,
                  width: Math.ceil(document.documentElement.clientWidth),
                  height: Math.ceil(r.bottom + window.scrollY),
                };
              })
              .catch(() => null)
          : sel
            ? null
            : await homeSectionRect(page, name);
      const el = sel ? page.locator(sel).first() : page.locator("main > section").first();
      const file = path.join(OUT, `${p.name}--${name}.png`);
      if (contentRect ? false : sel ? (await el.count()) === 0 : true) {
        rows.push({ page: p.name, section: name, file: "-", note: "not on this page" });
        continue;
      }
      try {
        // Cut the section out of a FULL PAGE screenshot, by its position in the
        // document, rather than photographing the element where it sits.
        //
        // Two earlier attempts at this both produced a picture that looked like
        // a broken page. An element screenshot scrolls the element under the
        // sticky header, so the top of a heading came out sliced and "Ordering
        // Guide" read as "Urdering Guide". Forcing the header to position:static
        // for the shot fixed that and painted the whole top menu across the
        // hero's first line instead, twice, once before a reflow wait and once
        // after. Both times the page itself was perfect.
        //
        // Playwright clips a full page capture in DOCUMENT coordinates, and a
        // full page capture has no sticky layer in it at all, so there is
        // nothing left to overlap and no layout to disturb. Measure, crop, done.
        const rect =
          contentRect ??
          (await el.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return {
              x: Math.max(0, Math.floor(r.left + window.scrollX)),
              y: Math.max(0, Math.floor(r.top + window.scrollY)),
              width: Math.ceil(r.width),
              height: Math.ceil(r.height),
            };
          }));
        const box = rect.width > 0 && rect.height > 0 ? rect : null;
        if (!box) {
          rows.push({ page: p.name, section: name, file: "-", note: "zero size" });
          continue;
        }
        await page.screenshot({ path: file, fullPage: true, clip: box });

        // Is there anything in it? A blank region costs almost nothing to
        // compress, so bytes per pixel separates a photograph from a white
        // rectangle without decoding the image. The blank booking calendar
        // measured 0.007 and the same crop with the calendar in it measured
        // 0.070, so the floor sits an order of magnitude below the real one.
        // A warning on the row, not a thrown error: a genuinely near-empty
        // section is legitimate and the person reading the table decides.
        let bytes = (await stat(file)).size;
        const area = box.width * box.height * (2 * 2);
        // A cross-origin iframe does not paint into a full page capture, so the
        // clip of one comes back white. His booking calendar is exactly that,
        // and the blank check above is what caught it rather than a person
        // noticing later. An element screenshot does render it, so the fallback
        // is that, and only for a crop that measured empty: the sticky header
        // problem an element shot brings back cannot apply to a section that
        // sits well below the fold.
        if (area > 0 && bytes / area < 0.01) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(1500);
          await el.screenshot({ path: file }).catch(() => {});
          bytes = (await stat(file)).size;
        }
        const thin = area > 0 && bytes / area < 0.01;
        if (thin) {
          console.log(
            `  ${C.red}FAIL${C.off}  ${p.name}/${name}: shot looks blank (${bytes} bytes over ${Math.round(area)} px)`,
          );
        }
        rows.push({
          page: p.name,
          section: name,
          file: path.basename(file),
          note: thin ? `LOOKS BLANK, ${bytes} bytes` : "",
        });
      } catch (e) {
        rows.push({ page: p.name, section: name, file: "-", note: String(e).split("\n")[0].slice(0, 60) });
      }
    }
    console.log(`  ${C.green}ok${C.off}    ${p.name} ${C.dim}(${status})${C.off}`);
  }

  await browser.close();

  const table = [
    "| page | section | file | note |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.page} | ${r.section} | ${r.file} | ${r.note} |`),
  ].join("\n");
  await writeFile(path.join(OUT, "INDEX.md"), `# ${SHOP} shots\n\nsigned in: ${signedIn}\n\n${table}\n`);

  console.log(`\n  ${rows.filter((r) => r.file !== "-").length} shot(s) in ${OUT}`);
  console.log(`  table: ${path.join(OUT, "INDEX.md")}\n`);
  process.exit(signedIn || !creds ? 0 : 1);
}

main();
