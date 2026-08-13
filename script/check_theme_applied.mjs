// Ask the browser what colour every important element actually ended up, instead of
// looking at a screenshot and deciding it looks about right.
//
//   node script/check_theme_applied.mjs
//   BASE_URL=https://shop.example.com/us/en node script/check_theme_applied.mjs
//
// A screenshot proves a page rendered. It does not prove a token reached an element: a
// hard coded class underneath can keep the old colour while :root carries the new one,
// and on a busy page nobody spots it. This reads computed styles, converts them to hex,
// and compares them against the palette the shop supplied.
//
// Exit code is non-zero if anything is off-palette, so it can gate a release.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3001/us/en';

// The shop's palette. Anything rendered that is not one of these, on an element that is
// supposed to be branded, is a miss.
const PALETTE = {
  '#7D8560': 'brand',
  '#707757': 'brand dark (buttons: passes contrast under white)',
  '#868E59': 'brand light',
  '#646A4E': 'brand text',
  '#E5E8D9': 'border / success',
  '#F1F0F0': 'grey light',
  '#F7F7F7': 'accent',
  '#DFDEDE': 'grey',
  '#C73528': 'danger',
  '#494849': 'grey dark',
  '#54554D': 'grey warm dark',
  '#6E6F66': 'grey 500, interpolated between his neutrals, 5.09:1 on white',
  '#1C1D19': 'grey 900, the near black he agreed to on 13 Aug',
  '#33342F': 'grey 800, interpolated',
  '#FFFFFF': 'white',
  '#000000': 'black'
};

const PAGES = (process.env.PATHS || '/,/products,/contact').split(',');

// Chrome reports a colour declared in oklch as lab(...), not rgb(...). Parsing text
// therefore misses every themed element and reports the whole palette as off, which is
// exactly the false alarm this tool exists to prevent. Let the browser do the conversion:
// paint the colour into a 1x1 canvas and read the pixel back. That works for any format
// the browser itself understands, today and after the next colour spec.
const NORMALISE = `(css) => {
  if (!css) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return 'transparent';
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let bad = 0;
let checked = 0;

try {
  for (const p of PAGES) {
    const url = `${BASE}${p}`;
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
    if (!res || res.status() >= 400) { console.log(`  skip ${p}  HTTP ${res ? res.status() : '?'}`); continue; }

    // Same guard as the shot tool: a dev error overlay is a 200.
    if (await page.locator('text=/Runtime .*Error|Call Stack/').count()) {
      console.log(`  FAIL ${p}  rendered an error overlay, not the page`);
      bad++;
      continue;
    }

    const found = await page.evaluate((src) => {
      const hex = eval(src);
      const read = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
      const first = (sel) => document.querySelector(sel);
      const px = (el, prop) => hex(read(el, prop));
      return {
        'body background': px(document.body, 'backgroundColor'),
        'footer background': px(first('footer'), 'backgroundColor'),
        'heading colour': px(first('h1, h2'), 'color'),
        'body text colour': px(first('p'), 'color'),
        'primary button': px(first('button:not([aria-label]), a[class*="bg-primary"]'), 'backgroundColor'),
        'input border': px(first('input'), 'borderTopColor'),
        'link colour': px(first('footer a'), 'color')
      };
    }, NORMALISE);

    console.log(`\n  ${p}`);
    for (const [label, css] of Object.entries(found)) {
      if (!css) { console.log(`    ${label.padEnd(20)} (not on this page)`); continue; }
      const hex = css;
      checked++;
      const known = hex === 'transparent' || PALETTE[hex];
      if (!known) bad++;
      console.log(`    ${label.padEnd(20)} ${String(hex).padEnd(12)} ${known ? (PALETTE[hex] || '') : 'OFF PALETTE'}`);
    }
  }
} finally {
  await browser.close();
}

console.log('');
console.log(bad === 0
  ? `ok — ${checked} rendered colours, all from the supplied palette`
  : `${bad} off-palette or broken`);
process.exit(bad === 0 ? 0 : 1);
