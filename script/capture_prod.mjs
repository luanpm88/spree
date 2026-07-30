// Capture the LIVE production system — admin and storefront — for the handover.
//
//   ADMIN_PASSWORD=... node script/capture_prod.mjs
//
// Shots land in docs/screenshots/prod/ and are embedded in docs/HANDOVER.md.
// These are the real deployed sites, not a local stack.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ADMIN = process.env.ADMIN_URL || 'https://spree.b-teka.com';
const SHOP = process.env.SHOP_URL || 'https://shop.b-teka.com';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@b-teka.com';
const PASSWORD = process.env.ADMIN_PASSWORD;
const OUT = path.resolve('docs/screenshots/prod');

if (!PASSWORD) {
  console.error('Set ADMIN_PASSWORD.');
  process.exit(1);
}

const results = [];

async function shoot(page, slug, caption, { full = false } = {}) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${slug}.png`), fullPage: full });
  results.push({ slug, caption, file: `screenshots/prod/${slug}.png` });
  console.log(`  ✓ ${slug}`);
}

// Detail pages are reached by reading hrefs off the list page — clicking admin
// table rows is unreliable (Turbo frames, overlays) and just times out.
async function openRecord(page, listUrl, resource, match) {
  await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const href = await page.locator('a[href]').evaluateAll(
    (as, { res, want }) => {
      const re = new RegExp(`/admin/${res}/([^/?#]+)(?:/edit)?(?:[?#].*)?$`);
      const skip = new Set(['new', 'search', 'select_options', 'edit', 'import', 'export']);
      const hits = [];
      for (const a of as) {
        const h = a.getAttribute('href');
        const m = h && h.match(re);
        if (!m || skip.has(m[1]) || m[1].startsWith('bulk_')) continue;
        hits.push({ h, text: `${a.textContent || ''} ${a.closest('tr')?.textContent || ''}` });
      }
      if (want) return (hits.find((x) => x.text.toLowerCase().includes(want.toLowerCase())) || {}).h || null;
      return hits.length ? hits[0].h : null;
    },
    { res: resource, want: match || null }
  );
  if (!href) throw new Error(`no ${resource} record${match ? ` matching "${match}"` : ''}`);
  await page.goto(new URL(href, ADMIN).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // ── storefront (public, no auth) ─────────────────────────────────────────
  console.log('storefront…');
  // Paths are locale-scoped (/{market}/{locale}/...). "Shop All" links to
  // /products; category pages live under /c/<taxon-path>. Guessing /shop
  // silently produced a 404 page that looked like a real screenshot, so these
  // are taken from the live navigation.
  const shopShots = [
    ['shop-01-home', `${SHOP}/us/en`, 'Storefront home page — shop.b-teka.com'],
    ['shop-02-listing', `${SHOP}/us/en/products`, 'Product listing — all products'],
    ['shop-04-category', `${SHOP}/us/en/c/kitchen`, 'Category page with filters — Kitchen'],
  ];
  for (const [slug, url, caption] of shopShots) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4500); // Next hydration + product images
      await shoot(page, slug, caption);
    } catch (e) {
      console.log(`  ✗ ${slug} — ${e.message.split('\n')[0]}`);
    }
  }

  // product detail — follow the first product card
  try {
    await page.goto(`${SHOP}/us/en`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    const link = await page.locator('a[href*="/products/"]').first().getAttribute('href');
    if (link) {
      await page.goto(new URL(link, SHOP).toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await shoot(page, 'shop-03-product', 'Product detail — variant selection and add to cart');
    }
  } catch (e) {
    console.log(`  ✗ shop-03-product — ${e.message.split('\n')[0]}`);
  }

  // ── admin (authenticated) ────────────────────────────────────────────────
  console.log('admin…');
  await page.goto(`${ADMIN}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await shoot(page, 'admin-01-login', 'Admin sign-in — spree.b-teka.com/admin');

  await page.fill('input[name="admin_user[email]"]', EMAIL);
  await page.fill('input[name="admin_user[password]"]', PASSWORD);
  await page.locator('form[action*="sign_in"] button[type="submit"]').first().click();
  await page.waitForTimeout(3000);

  await page.goto(`${ADMIN}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (/sign_in/.test(page.url())) throw new Error('admin login failed — check ADMIN_PASSWORD');
  await shoot(page, 'admin-02-dashboard', 'Admin dashboard');

  const simple = [
    ['admin-03-products', '/admin/products', 'Products — 36 products / 121 variants'],
    ['admin-04-orders', '/admin/orders', 'Orders'],
    ['admin-05-customers', '/admin/users', 'Customers'],
    ['admin-06-customer-groups', '/admin/customer_groups', 'Customer groups — the basis of B2B pricing'],
    ['admin-09-channels', '/admin/channels', 'Sales channels — online (B2C) / wholesale (B2B) / POS'],
    ['admin-11-roles', '/admin/roles', 'Roles and permissions — six job-function roles'],
  ];
  for (const [slug, p, caption] of simple) {
    try {
      await page.goto(`${ADMIN}${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await shoot(page, slug, caption);
    } catch (e) {
      console.log(`  ✗ ${slug} — ${e.message.split('\n')[0]}`);
    }
  }

  const records = [
    ['admin-07-product-detail', '/admin/products', 'products', null, 'Product detail — price and stock live on the variant'],
    ['admin-08-price-list', '/admin/price_lists', 'price_lists', null, 'Wholesale price list — Volume Rule (10+) AND Customer Group Rule'],
    ['admin-10-channel-b2b', '/admin/channels', 'channels', 'Wholesale', 'B2B gate — Login required, guest checkout disabled'],
  ];
  for (const [slug, list, res, match, caption] of records) {
    try {
      await openRecord(page, `${ADMIN}${list}`, res, match);
      await shoot(page, slug, caption);
    } catch (e) {
      console.log(`  ✗ ${slug} — ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length} production screenshots → docs/screenshots/prod/`);
};

run().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
