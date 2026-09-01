// Screenshot a page with the point drawn ON it, so the picture explains itself.
//
//   node script/annotate_shot.mjs
//
// ── why ──────────────────────────────────────────────────────────────────────
//
// A bare screenshot sent to a client asks them to find the thing you are talking
// about. If the message says "the Submit button is the wrong colour" and the shot is a
// full page of form fields, they scroll, they guess, and half the time they answer the
// wrong question. Drawing the callout into the image removes that step.
//
// The interesting part is that the element being pointed at lives inside a CROSS-ORIGIN
// iframe. JavaScript on the page cannot measure it. Playwright can, because it drives
// the browser rather than running inside the page, so frameLocator().boundingBox()
// returns real coordinates in the top frame's space. The overlay is then drawn in the
// top frame at those coordinates.
//
// Output: tmp/annotated/<name>.png
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const die = (m) => { console.error(`FAIL  ${m}`); process.exit(1); };

const BASE = process.env.BASE_URL || 'http://localhost:3001/us/en';
const OUT = process.env.OUT || 'tmp/annotated';

// Each shot: where to go, what to point at, and what to say about it.
// Hosts come from .estate, which is gitignored, rather than being written here.
// This file is tracked and the repository is public, so a hostname typed into it
// is client data in the open. check_no_client_data caught exactly that.
//
//   node script/annotate_shot.mjs            uses the shops named in SHOTS below
//
// SHOP_HOST('b2b') returns that shop's storefront host from the estate file.
const estate = existsSync('.estate') ? readFileSync('.estate', 'utf8') : '';
const SHOP_HOST = (key) => {
  for (const line of estate.split('\n')) {
    const c = line.split('|');
    if (c[0]?.trim() === key && c[5]?.trim() && c[5].trim() !== '-') return `https://${c[5].trim()}`;
  }
  die(`no storefront host for '${key}' in .estate`);
};
// The shot list.
//
// A client's list names his shops and quotes his page copy, so it lives in
// tmp/client/annotate_shots.mjs, which is gitignored. check_no_client_data
// caught this file carrying hostnames and a shop key, in a public repository.
//
// Falls back to one generic shot so the tool still runs in a fresh checkout.
const SHOTS = existsSync('tmp/client/annotate_shots.mjs')
  ? (await import(`${process.cwd()}/tmp/client/annotate_shots.mjs`)).default({ SHOP_HOST })
  : [
      {
        name: '1-home',
        url: `${process.env.BASE_URL || 'http://localhost:3001/us/en'}/`,
        viewport: { width: 1440, height: 900 },
        notes: []
      }
    ];


// ── signing in, because the shop he reviews most is the one behind a login ───
//
// The wholesale shop refuses every address to a visitor without an account, so
// this tool could photograph any shop except the one that gets the most notes
// drawn on it. Every proof shot of it had to be taken by hand.
//
// Credentials come from .shopauth, which is gitignored, keyed by shop. A shot
// asks for sign-in with `signIn: 'b2b'`.
const readAuth = async (shop) => {
  const { readFile } = await import('node:fs/promises');
  const env = {};
  for (const line of (await readFile('.shopauth', 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const k = shop.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (!env[`${k}_EMAIL`]) die(`no ${k}_EMAIL in .shopauth, cannot photograph a gated shop`);
  return { email: env[`${k}_EMAIL`], password: env[`${k}_PASSWORD`] };
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let made = 0;

try {
  for (const shot of SHOTS) {
    const ctx = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();

    if (shot.signIn) {
      const { email, password } = await readAuth(shot.signIn);
      await page.goto(shot.signInUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(2500);
      if (await page.locator('input[type="password"]').count()) {
        await page.fill('input[type="email"], input[name="email"]', email);
        await page.fill('input[type="password"], input[name="password"]', password);
        await Promise.all([
          page.waitForLoadState('networkidle').catch(() => {}),
          page.click('button[type="submit"]'),
        ]);
        await page.waitForTimeout(3000);
      }
      // Assert it worked. A failed sign-in leaves the login form on screen, and
      // a shot of the login form labelled "your product names are back" is worse
      // than no shot at all.
      if (await page.locator('input[type="password"]').count()) {
        die(`${shot.name}: sign-in did not take, still looking at the password field`);
      }
    }

    // This page embeds a third party form that pulls in a captcha, so networkidle is at
    // the mercy of someone else's server. One retry, and a skip is FATAL rather than a
    // shrug: a missing shot leaves the previous run's file sitting there, which is how
    // an unlabelled screenshot ends up in a set that is supposed to be labelled.
    let res = null;
    for (const attempt of [1, 2]) {
      try {
        res = await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 90000 });
        break;
      } catch (e) {
        if (attempt === 2) die(`${shot.name}: ${e.message.split('\n')[0].slice(0, 80)}`);
        console.log(`  retry ${shot.name}`);
      }
    }
    if (!res || res.status() >= 400) die(`${shot.name}: HTTP ${res ? res.status() : '?'}`);

    // A Next dev error overlay returns 200 and looks like a page. Refuse to ship one.
    const broken = await page.locator('text=/Runtime .*Error|Call Stack/').count();
    if (broken > 0) die(`${shot.name} rendered a Next error overlay, not the page`);

    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);

    // frameLocator(undefined) throws, and the catch that used to wrap this swallowed it,
    // so a shot that never scrolled still reported ok and shipped a picture of the wrong
    // part of the page. Only reach into a frame when one was named.
    if (shot.scrollTo) {
      const target = shot.frameSelector
        ? page.frameLocator(shot.frameSelector).locator(shot.scrollTo).first()
        : page.locator(shot.scrollTo).first();
      await target.scrollIntoViewIfNeeded({ timeout: 20000 });
      await page.waitForTimeout(700);
    }

    // Measure every target BEFORE drawing, so an overlay never shifts what comes next.
    const boxes = [];
    for (const note of shot.notes) {
      const target = note.frame
        ? page.frameLocator(note.frame).locator(note.selector).first()
        : page.locator(note.selector).first();
      const box = await target.boundingBox({ timeout: 20000 }).catch(() => null);
      if (!box) die(`${shot.name}: could not measure ${note.selector}`);

      // boundingBox happily returns coordinates for something scrolled off screen, and
      // the overlay then lands outside the picture. The result is a screenshot with no
      // callout on it that still says ok, which is the one outcome this tool must not
      // have. Scroll it in and measure again rather than guess.
      const vp = page.viewportSize();
      if (box.y < 0 || box.y + box.height > vp.height) {
        await target.scrollIntoViewIfNeeded({ timeout: 20000 });
        await page.waitForTimeout(500);
        const again = await target.boundingBox({ timeout: 20000 }).catch(() => null);
        if (!again || again.y < 0 || again.y + again.height > vp.height) {
          die(`${shot.name}: ${note.selector} will not fit in a ${vp.width}x${vp.height} shot`);
        }
        boxes.push({ box: again, note });
        continue;
      }
      boxes.push({ box, note });
    }
    // A shot with no notes is deliberate: a clean picture with nothing drawn on it.

    // A banner saying where the shot came from. A screenshot of a local machine sent to
    // a client reads as production unless it says otherwise, and the difference between
    // "this is live" and "this is ready to go live" is the whole message.
    if (process.env.LABEL) {
      await page.evaluate((text) => {
        const b = document.createElement('div');
        b.textContent = text;
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;' +
          'background:#1f2937;color:#fff;padding:7px 14px;font:600 13px/1.3 -apple-system,' +
          'BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;letter-spacing:.02em;' +
          'text-align:center;pointer-events:none';
        document.body.appendChild(b);
      }, process.env.LABEL);
    }

    if (boxes.length) await page.evaluate(({ items, spotlight }) => {
      const COLOUR = { ok: '#1f7a3d', warn: '#c2410c' };
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif';

      for (const { box, note } of items) {
        const c = COLOUR[note.tone] || COLOUR.warn;

        // The spotlight is opt-in now, and it used to be always on.
        //
        // It was a 35% white scrim over everything except the ring, which is a
        // fair way to draw the eye and a bad way to show a client a colour. His
        // #065146 footer photographed as #5D8E87 and his #EAEEED strip as
        // #F1F4F3: every colour on the page 35% lighter than it really is, in a
        // picture sent to prove those exact colours were right. He had just
        // reported colour faults, so the shot invited another one.
        //
        // The DOM was innocent and said so: computed background was rgb(6,81,70)
        // the whole time, and nothing in the ancestor chain had opacity below 1.
        // Only sampling the saved PNG found it, which is the same lesson as
        // "open every image" one screen up.
        const ring = document.createElement('div');
        ring.style.cssText = `position:absolute;left:${box.x - 6}px;top:${box.y - 6}px;` +
          `width:${box.width + 12}px;height:${box.height + 12}px;` +
          `border:3px solid ${c};border-radius:8px` +
          (spotlight ? `;box-shadow:0 0 0 9999px rgba(255,255,255,.35)` : '');
        layer.appendChild(ring);

        // Put the label wherever there is room, so it never runs off the viewport.
        const label = document.createElement('div');
        label.textContent = note.text;
        const wantLeft = box.x + box.width + 22;
        const fitsRight = wantLeft + 430 < window.innerWidth;
        // Above beats below. Below drops the label onto whatever follows the element,
        // which on a page of prose is the sentence you were trying to show.
        const fitsAbove = box.y > 110;
        label.style.cssText = 'position:absolute;max-width:420px;white-space:pre-line;' +
          `background:${c};color:#fff;padding:11px 14px;border-radius:8px;` +
          'box-shadow:0 6px 18px rgba(0,0,0,.28);' +
          (fitsRight
            ? `left:${wantLeft}px;top:${Math.max(8, box.y - 6)}px;`
            : fitsAbove
              ? `left:${Math.max(12, box.x)}px;bottom:${window.innerHeight - box.y + 18}px;`
              : `left:${Math.max(12, box.x)}px;top:${box.y + box.height + 20}px;`);
        layer.appendChild(label);

        const line = document.createElement('div');
        line.style.cssText = fitsRight
          ? `position:absolute;left:${box.x + box.width + 6}px;top:${box.y + box.height / 2}px;` +
            `width:16px;height:3px;background:${c}`
          : fitsAbove
            ? `position:absolute;left:${box.x + 24}px;bottom:${window.innerHeight - box.y + 4}px;` +
              `width:3px;height:14px;background:${c}`
            : `position:absolute;left:${box.x + box.width / 2}px;top:${box.y + box.height + 6}px;` +
              `width:3px;height:14px;background:${c}`;
        layer.appendChild(line);
      }
      document.body.appendChild(layer);
    }, { items: boxes, spotlight: Boolean(shot.spotlight) });

    await page.waitForTimeout(250);
    const file = path.join(OUT, `${shot.name}.png`);
    // animations: 'disabled' fast-forwards CSS transitions to their end state.
    //
    // Without it this shipped a picture of the client's shop with every colour on
    // the page washed out. The storefront fades content in, and the shot landed
    // mid fade: his #065146 footer photographed as #5D8E87, the strip as #F1F4F3.
    // Measured rather than guessed, and the tell was that all three were the
    // declared colour at exactly 0.65 alpha over white, which is one fade rather
    // than three wrong values.
    //
    // getComputedStyle could not have caught it either: it reports the DECLARED
    // colour, so a probe said rgb(6,81,70) while the pixels said otherwise. The
    // only thing that catches this is sampling the image, which is why the rule
    // above says open every file.
    await page.screenshot({ path: file, fullPage: shot.fullPage, animations: 'disabled' });

    // Then prove it, by reading a pixel back rather than trusting the flag.
    //
    // `expectColour` names a selector and the colour it must actually photograph
    // as. The check samples the saved PNG at that element's centre and fails when
    // the pixel is more than a few values off. A washed-out shot of a client's
    // brand colour is worse than no shot: it invites him to report a bug that is
    // only in the picture.
    if (shot.expectColour) {
      const { selector, hex } = shot.expectColour;
      const box = await page.locator(selector).first().boundingBox();
      if (!box) die(`${shot.name}: cannot measure ${selector} to verify its colour`);
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const { execFileSync } = await import('node:child_process');
      const px = execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open("${file}").convert("RGB")
w,h = im.size
# The PNG is deviceScaleFactor times the CSS box, so scale before sampling.
sx = w / ${page.viewportSize().width}
print(*im.getpixel((int((${box.x} + ${box.width}/2) * sx), int((${box.y} + ${box.height}/2) * sx))))
`]).toString().trim().split(/\s+/).map(Number);
      const off = Math.max(...want.map((v, i) => Math.abs(v - px[i])));
      if (off > 6) {
        die(`${shot.name}: ${selector} photographed as rgb(${px.join(',')}) but should be ${hex}. ` +
            `Off by ${off}. If every colour on the page is off by a similar ratio the shot caught a fade.`);
      }
      console.log(`  colour ok  ${selector} is ${hex}`);
    }
    made++;
    console.log(`  ok    ${file}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (!made) die('no annotated shot was produced');
console.log(`\nok — ${made} annotated shot(s) in ${OUT}/`);
