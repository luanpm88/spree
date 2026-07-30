// Verify each demo role can reach what it should and is blocked from the rest.
//
//   node script/audit_roles.mjs
//
// Creating a Spree::Role grants nothing by itself — the role name must be given
// permission sets in config/initializers/spree.rb. This script proves the wiring
// actually bites instead of trusting the config.
//
// A page counts as DENIED when it redirects away, 401/403s, or renders an
// "authoriz*" error. Everything else counts as ALLOWED.

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.PASSWORD || 'spree123456';

const PATHS = [
  ['dashboard', '/admin'],
  ['products', '/admin/products'],
  ['stock', '/admin/stock_items'],
  ['orders', '/admin/orders'],
  ['customers', '/admin/users'],
  ['price lists', '/admin/price_lists'],
  ['promotions', '/admin/promotions'],
  ['roles', '/admin/roles'],
  ['store config', '/admin/store/edit'],
];

// role => what we EXPECT to be reachable. Anything else should be denied.
//
// NOTE on 'price lists': in Spree 5.6 the Price Lists screen is gated by
// ProductDisplay, not ProductManagement — so any role that can view products
// can also view price lists, including the read-only ones. Verified by this
// script. It is Spree's design, not a choice here, and it means a read-only
// support account CAN see wholesale pricing. If that matters commercially,
// drop ProductDisplay from :support and give it OrderDisplay only.
const EXPECT = {
  admin: ['dashboard', 'products', 'stock', 'orders', 'customers', 'price lists', 'promotions', 'roles', 'store config'],
  manager: ['dashboard', 'products', 'stock', 'orders', 'customers', 'price lists', 'promotions'],
  catalog: ['dashboard', 'products', 'stock', 'price lists'],
  fulfillment: ['dashboard', 'products', 'stock', 'orders', 'customers', 'price lists'],
  sales_b2b: ['dashboard', 'products', 'stock', 'orders', 'customers', 'price lists'],
  support: ['dashboard', 'products', 'orders', 'customers', 'price lists'],
};

const probe = async (page, url) => {
  let status = 0;
  const res = await page
    .goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    .catch(() => null);
  if (res) status = res.status();
  await page.waitForTimeout(150);

  if (status === 401 || status === 403) return false;
  // Bounced to login or back to the dashboard => not permitted.
  const here = page.url();
  if (/sign_in/.test(here)) return false;
  if (url.replace(BASE, '') !== '/admin' && /\/admin\/?$/.test(here)) return false;

  // Only the actual CanCan denial flash counts. Do NOT loosely match
  // /authoriz/ — the admin sidebar links to "Return Authorizations", so a
  // substring test marks every fully-populated page as denied.
  const body = (await page.textContent('body').catch(() => '')) || '';
  if (/not authorized to (access|visit|perform)/i.test(body)) return false;
  return true;
};

const run = async () => {
  const browser = await chromium.launch();
  const rows = [];
  let problems = 0;

  for (const role of Object.keys(EXPECT)) {
    const email = `${role}@b-teka.com`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="admin_user[email]"]', email);
    await page.fill('input[name="admin_user[password]"]', PASSWORD);
    await page.locator('form[action*="sign_in"] button[type="submit"]').first().click();
    await page.waitForTimeout(2200);

    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    if (/sign_in/.test(page.url())) {
      console.log(`\n${role.padEnd(12)} LOGIN FAILED (${email})`);
      problems++;
      await ctx.close();
      continue;
    }

    const allowed = [];
    for (const [label, p] of PATHS) {
      if (await probe(page, `${BASE}${p}`)) allowed.push(label);
    }

    const want = new Set(EXPECT[role]);
    const got = new Set(allowed);
    const unexpected = [...got].filter((x) => !want.has(x)); // reachable but shouldn't be
    const blocked = [...want].filter((x) => !got.has(x)); // should reach but can't

    rows.push({ role, allowed, unexpected, blocked });
    if (unexpected.length || blocked.length) problems++;

    await ctx.close();
  }

  await browser.close();

  console.log('\nROLE ACCESS AUDIT');
  console.log('='.repeat(78));
  for (const r of rows) {
    console.log(`\n${r.role}`);
    console.log(`  reachable : ${r.allowed.join(', ') || '(nothing)'}`);
    if (r.unexpected.length) console.log(`  OVER-PRIVILEGED: ${r.unexpected.join(', ')}`);
    if (r.blocked.length) console.log(`  over-restricted: ${r.blocked.join(', ')}`);
    if (!r.unexpected.length && !r.blocked.length) console.log('  matches expectation');
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log(problems === 0 ? 'PASS — every role matches expectation' : `${problems} role(s) differ from expectation`);
  // Informational: an unexpected result is a finding to read, not a build break.
  process.exit(0);
};

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
