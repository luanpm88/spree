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
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3001/us/en';
const OUT = process.env.OUT || 'tmp/annotated';

// Each shot: where to go, what to point at, and what to say about it.
const SHOTS = [
  {
    // Proof of delivery. No callout: the heading and the four paragraphs are his own
    // words, so a label pointing at them says nothing the picture does not, and the
    // first version of this shot put the label straight on top of the paragraph it was
    // meant to be showing off.
    name: '1-contact-page',
    url: `${BASE}/contact`,
    viewport: { width: 1440, height: 1150 },
    notes: []
  },
  {
    name: '2-footer-link',
    url: `${BASE}/contact`,
    viewport: { width: 1440, height: 1000 },
    scrollTo: 'footer',
    notes: [
      {
        selector: 'footer a[href$="/contact"]',
        text: 'New: the page is linked here.\nBefore this it existed but nothing pointed at it.',
        tone: 'ok'
      }
    ]
  },
  {
    name: '3-submit-button',
    url: `${BASE}/contact`,
    viewport: { width: 1440, height: 1000 },
    frameSelector: 'iframe',
    scrollTo: 'button[type="submit"]',
    notes: [
      {
        frame: 'iframe',
        selector: 'button[type="submit"]',
        text: 'Green now. The line that does it is\n#main_body button[type="submit"].',
        tone: 'ok'
      }
    ]
  }
];


const die = (m) => { console.error(`FAIL  ${m}`); process.exit(1); };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let made = 0;

try {
  for (const shot of SHOTS) {
    const ctx = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();

    let res;
    try {
      res = await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (e) {
      console.log(`  skip  ${shot.name}  (${e.message.split('\n')[0].slice(0, 70)})`);
      await ctx.close();
      continue;
    }
    if (!res || res.status() >= 400) {
      console.log(`  skip  ${shot.name}  HTTP ${res ? res.status() : '?'}`);
      await ctx.close();
      continue;
    }

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

    if (boxes.length) await page.evaluate((items) => {
      const COLOUR = { ok: '#1f7a3d', warn: '#c2410c' };
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif';

      for (const { box, note } of items) {
        const c = COLOUR[note.tone] || COLOUR.warn;

        const ring = document.createElement('div');
        ring.style.cssText = `position:absolute;left:${box.x - 6}px;top:${box.y - 6}px;` +
          `width:${box.width + 12}px;height:${box.height + 12}px;` +
          `border:3px solid ${c};border-radius:8px;box-shadow:0 0 0 9999px rgba(255,255,255,.35)`;
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
    }, boxes);

    await page.waitForTimeout(250);
    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: shot.fullPage });
    made++;
    console.log(`  ok    ${file}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (!made) die('no annotated shot was produced');
console.log(`\nok — ${made} annotated shot(s) in ${OUT}/`);
