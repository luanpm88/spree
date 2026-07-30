// Capture screenshots of the running Spree admin for docs/USER_GUIDE.md + PDF.
//
//   node script/capture_screenshots.mjs
//
// Needs the local stack up (`make up`) and an admin user that can sign in.
// Override with env: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, MAILPIT_URL.
//
// Screens that fail are reported and skipped — the guide is built from
// whatever succeeded, so a renamed route never blocks the whole run.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@b-teka.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'spree123456';
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';
const OUT = path.resolve('docs/screenshots');

// slug, url, caption, options
const SHOTS = [
  ['01-login',            `${BASE}/admin_user/sign_in`, 'Trang đăng nhập admin', { noAuth: true }],
  ['02-dashboard',        `${BASE}/admin`,              'Dashboard — tổng quan doanh thu, đơn hàng'],
  ['03-products',         `${BASE}/admin/products`,     'Danh sách sản phẩm'],
  ['04-product-edit',     null,                          'Chi tiết một sản phẩm — biến thể, giá, tồn kho', { recordIn: [`${BASE}/admin/products`, 'products'] }],
  ['05-taxonomies',       `${BASE}/admin/taxonomies`,   'Taxonomy — cây danh mục'],
  ['06-orders',           `${BASE}/admin/orders`,       'Danh sách đơn hàng'],
  ['07-order-detail',     null,                          'Chi tiết đơn hàng', { recordIn: [`${BASE}/admin/orders`, 'orders'] }],
  ['08-customers',        `${BASE}/admin/users`,        'Khách hàng'],
  ['09-customer-groups',  `${BASE}/admin/customer_groups`, 'Nhóm khách hàng — nền tảng phân giá B2B'],
  ['10-price-lists',      `${BASE}/admin/price_lists`,  'Bảng giá (Price Lists) — giá sỉ B2B'],
  ['11-price-list-detail',null,                          'Bảng giá Wholesale và các điều kiện áp dụng', { recordIn: [`${BASE}/admin/price_lists`, 'price_lists'] }],
  ['12-channels',         `${BASE}/admin/channels`,     'Channels — online / wholesale / POS'],
  // Two channels side by side is the clearest way to show the B2B gate:
  // the B2C one inherits defaults, the B2B one requires a login.
  ['13a-channel-b2c',     null,                          'Channel B2C "Online Store" — mọi thứ để mặc định', { recordIn: [`${BASE}/admin/channels`, 'channels', 'Online Store'] }],
  ['13b-channel-b2b',     null,                          'Channel B2B "Wholesale" — Storefront access = Login required, Guest checkout = tắt', { recordIn: [`${BASE}/admin/channels`, 'channels', 'Wholesale'] }],
  ['14-markets',          `${BASE}/admin/markets`,      'Markets — nhóm quốc gia theo vùng'],
  ['15-promotions',       `${BASE}/admin/promotions`,   'Khuyến mãi'],
  ['16-shipping-methods', `${BASE}/admin/shipping_methods`, 'Phương thức vận chuyển'],
  ['17-payment-methods',  `${BASE}/admin/payment_methods`,  'Cổng thanh toán'],
  ['18-stock',            `${BASE}/admin/stock_items`,  'Tồn kho'],
  ['19-tax-rates',        `${BASE}/admin/tax_rates`,    'Thuế'],
  ['20-store-settings',   `${BASE}/admin/store/edit`,   'Cấu hình cửa hàng'],
  ['21-roles',            `${BASE}/admin/roles`,        'Vai trò & phân quyền'],
  ['22-webhooks',         `${BASE}/admin/webhook_endpoints`, 'Webhook — bắn sự kiện ra hệ thống ngoài'],
  ['23-mailpit',          MAILPIT,                       'Mailpit — hộp thư bắt toàn bộ email ở local', { noAuth: true }],
];

const results = [];

async function shoot(page, slug, caption) {
  await page.waitForTimeout(700); // let Turbo + lazy images settle
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  results.push({ slug, caption, file: `screenshots/${slug}.png` });
  console.log(`  ✓ ${slug}`);
}

const run = async () => {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // crisp in print
  });
  const page = await ctx.newPage();

  // ── sign in ───────────────────────────────────────────────────────────────
  console.log('signing in…');
  await page.goto(`${BASE}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });

  // Grab the login screen BEFORE filling it (it is shot #1).
  await shoot(page, '01-login', 'Trang đăng nhập admin');

  // Field names are admin_user[...] — target them exactly. The page also
  // contains hidden turbo-confirm modal buttons that also match
  // button[type=submit], so scope the click to the login form.
  await page.fill('input[name="admin_user[email]"]', EMAIL);
  await page.fill('input[name="admin_user[password]"]', PASSWORD);

  // The form is Turbo-driven, so the submit is a fetch plus a client-side
  // visit. Waiting on the post-submit URL is flaky — the intermediate visit can
  // surface as chrome-error://chromewebdata even when the session cookie was
  // set fine. So: submit, give it a moment, then prove auth by loading /admin
  // and checking we are not bounced back to the login form.
  await page.locator('form[action*="sign_in"] button[type="submit"]').first().click();
  await page.waitForTimeout(2500);

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  if (/sign_in/.test(page.url())) {
    const flash = await page
      .locator('[class*="alert"], [role="alert"], .flash')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `login failed — bounced back to ${page.url()}` +
        (flash ? ` — page said: ${flash.trim().slice(0, 200)}` : '') +
        `. Check ADMIN_EMAIL / ADMIN_PASSWORD.`
    );
  }
  console.log(`  signed in → ${page.url()}`);

  // ── the rest ──────────────────────────────────────────────────────────────
  for (const [slug, url, caption, opts = {}] of SHOTS) {
    if (slug === '01-login') continue; // already captured
    try {
      if (opts.noAuth && url === MAILPIT) {
        const p2 = await ctx.newPage();
        await p2.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await p2.waitForTimeout(1200);
        const file = path.join(OUT, `${slug}.png`);
        await p2.screenshot({ path: file });
        results.push({ slug, caption, file: `screenshots/${slug}.png` });
        console.log(`  ✓ ${slug}`);
        await p2.close();
        continue;
      }

      if (opts.recordIn) {
        // Open a detail page without clicking. Clicking is unreliable here:
        // admin rows wrap links in Turbo frames and overlays, so the first
        // match is often not the visible one and .click() just times out.
        // Instead read hrefs off the list page and navigate straight to one.
        const [listUrl, resource, matchText] = opts.recordIn;
        await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);

        // Record URLs are /admin/<res>/<id> OR /admin/<res>/<id>/edit —
        // products and channels only link the edit form. So capture the id
        // segment and reject the collection-level action routes by name,
        // rather than filtering on a trailing /edit.
        const href = await page.locator('a[href]').evaluateAll(
          (as, { res, want }) => {
            const re = new RegExp(`/admin/${res}/([^/?#]+)(?:/edit)?(?:[?#].*)?$`);
            const notAnId = new Set([
              'new', 'search', 'select_options', 'edit', 'import', 'export',
            ]);
            const candidates = [];
            for (const a of as) {
              const h = a.getAttribute('href');
              if (!h) continue;
              const m = h.match(re);
              if (!m) continue;
              const id = m[1];
              if (notAnId.has(id) || id.startsWith('bulk_')) continue;
              // Match on the link text, or on the whole row it sits in — the
              // name is not always inside the anchor itself.
              const text = `${a.textContent || ''} ${a.closest('tr')?.textContent || ''}`;
              candidates.push({ h, text });
            }
            if (want) {
              const hit = candidates.find((c) =>
                c.text.toLowerCase().includes(want.toLowerCase())
              );
              return hit ? hit.h : null;
            }
            return candidates.length ? candidates[0].h : null;
          },
          { res: resource, want: matchText || null }
        );

        if (!href) {
          throw new Error(
            `no ${resource} record link${matchText ? ` matching "${matchText}"` : ''} on the list page`
          );
        }
        await page.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
      } else {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }

      await shoot(page, slug, caption);
    } catch (err) {
      console.log(`  ✗ ${slug} — ${err.message.split('\n')[0]}`);
      results.push({ slug, caption, file: null, error: err.message.split('\n')[0] });
    }
  }

  await browser.close();

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.file).length;
  console.log(`\n${ok}/${results.length} screenshots captured → docs/screenshots/`);
  const failed = results.filter((r) => !r.file);
  if (failed.length) {
    console.log('missing:');
    failed.forEach((f) => console.log(`  ${f.slug}: ${f.error}`));
  }
};

run().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
