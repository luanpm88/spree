// Screenshot the storefront so the client can look at a theme before it is agreed.
//
//   node script/capture_theme.mjs
//   BASE_URL=http://localhost:3001 OUT=tmp/theme node script/capture_theme.mjs
//
// He asked for "a screenshot or a link so I can see a theme idea before we add it",
// so these are shots of the real storefront with the real catalogue, not a mockup.
// A mockup would show colours he cannot check against his own products.
//
// It also reads back the computed colour of a real button and a real link and prints
// them, because a screenshot proves the page rendered but not that the token actually
// reached the element. A palette can look applied while a hard coded class underneath
// is still the old colour.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const OUT = process.env.OUT || 'tmp/theme';
const PATHS = (process.env.PATHS || '/,/products,/wholesale/apply,/account/register').split(',');

const die = (m) => { console.error(`FAIL  ${m}`); process.exit(1); };

const shots = [];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 },
                          { name: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2
    });
    const page = await ctx.newPage();

    for (const p of PATHS) {
      const url = `${BASE}${p}`;
      let res;
      try {
        res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      } catch (e) {
        console.log(`  skip  ${viewport.name} ${p}  (${e.message.split('\n')[0].slice(0, 60)})`);
        continue;
      }
      if (!res || res.status() >= 400) {
        console.log(`  skip  ${viewport.name} ${p}  HTTP ${res ? res.status() : '?'}`);
        continue;
      }
      // Fonts and images decode after networkidle often enough to matter in a shot
      // that is going to a client, so wait for them rather than hope.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);

      const name = `${viewport.name}${p.replace(/\//g, '-') || '-home'}.png`;
      await page.screenshot({ path: path.join(OUT, name), fullPage: viewport.name === 'desktop' });
      shots.push(name);
      console.log(`  ok    ${name}`);
    }

    if (viewport.name === 'desktop') {
      // Proof the tokens reached real elements, not just :root.
      await page.goto(`${BASE}${PATHS[0]}`, { waitUntil: 'networkidle' }).catch(() => {});
      const probe = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const btn = document.querySelector('button, [role=button], a[class*=bg-]');
        const read = (el, prop) => (el ? getComputedStyle(el)[prop] : 'none');
        return {
          primary: root.getPropertyValue('--primary').trim(),
          border: root.getPropertyValue('--border').trim(),
          ring: root.getPropertyValue('--ring').trim(),
          firstButtonBg: read(btn, 'backgroundColor'),
          firstButtonColor: read(btn, 'color'),
          bodyBg: getComputedStyle(document.body).backgroundColor
        };
      });
      console.log('\n  tokens as the browser actually computed them:');
      for (const [k, v] of Object.entries(probe)) console.log(`    ${k.padEnd(18)} ${v}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (!shots.length) die('no page could be captured');
console.log(`\nok — ${shots.length} shots in ${OUT}/`);
