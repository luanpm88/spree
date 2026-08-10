// Walk docs/HANDOVER.md end to end as the client would, and prove or disprove
// every claim it makes against the LIVE production system.
//
//   HANDOVER_PASSWORD=... PK_ONLINE=pk_... PK_WHOLESALE=pk_... \
//     node script/verify_handover.mjs
//
// Writes proof screenshots to docs/screenshots/verify/ and prints a pass/fail
// table. Exits non-zero if any claim fails, so it can gate a handover.
//
// This deliberately re-derives everything from the running site rather than
// trusting the document — the point is to catch the document being wrong.
//
// Every credential comes from the environment. They used to be literals here, and
// this file is tracked in a public repo, so the API keys were published along with
// it. Read them from the server's .env, or from the admin under Channels.

import { chromium, request as pwRequest } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const ADMIN = 'https://spree.b-teka.com';
const SHOP = 'https://shop.b-teka.com';
const PW = process.env.HANDOVER_PASSWORD;
const PK_ONLINE = process.env.PK_ONLINE;
const PK_WHOLESALE = process.env.PK_WHOLESALE;
const OUT = path.resolve('docs/screenshots/verify');

const missing = Object.entries({ HANDOVER_PASSWORD: PW, PK_ONLINE, PK_WHOLESALE })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} — see the header of this file.`);
  process.exit(1);
}

const results = [];
const check = (claim, pass, detail = '') => {
  results.push({ claim, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${claim}${detail ? ` — ${detail}` : ''}`);
};

const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

// Reachable = not bounced to sign-in, not 401/403, no CanCan denial flash.
async function reachable(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => null);
  const status = res ? res.status() : 0;
  await page.waitForTimeout(200);
  if (status === 401 || status === 403) return false;
  if (/sign_in/.test(page.url())) return false;
  if (url.replace(ADMIN, '') !== '/admin' && /\/admin\/?$/.test(page.url())) return false;
  const body = (await page.textContent('body').catch(() => '')) || '';
  return !/not authorized to (access|visit|perform)/i.test(body);
}

// Sign in over HTTP, then hand the resulting cookies to a browser context.
//
// Driving the Turbo-powered login form with Playwright proved unreliable at
// speed: the submit is a background fetch, and whichever accounts happened to
// run last in a loop failed, with a different set failing on each run. Eight
// sequential logins over plain HTTP return 302 then 200 every time, so the
// server authenticates all accounts correctly — the flakiness was entirely in
// the browser automation. Authenticating over HTTP removes that variable while
// still giving a real, cookie-backed session for the page-level checks below.
async function httpLogin(browser, email) {
  const api = await pwRequest.newContext({ baseURL: ADMIN });

  const form = await (await api.get('/admin_user/sign_in')).text();
  const token = (form.match(/name="authenticity_token" value="([^"]+)"/) || [])[1];
  if (!token) {
    await api.dispose();
    return { ok: false, reason: 'no CSRF token on the sign-in page' };
  }

  const post = await api.post('/admin_user/sign_in', {
    form: {
      authenticity_token: token,
      'admin_user[email]': email,
      'admin_user[password]': PW,
    },
    maxRedirects: 0,
  });

  // Devise redirects on success; a re-rendered 200 means the credentials failed.
  if (post.status() !== 302) {
    await api.dispose();
    return { ok: false, reason: `sign-in returned ${post.status()} (expected 302)` };
  }

  const state = await api.storageState();
  await api.dispose();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (/sign_in/.test(page.url())) {
    return { ctx, page, ok: false, reason: 'session cookie did not carry into the browser' };
  }
  return { ctx, page, ok: true };
}

async function adminLoginViaForm(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="admin_user[email]"]', email);
  await page.fill('input[name="admin_user[password]"]', PW);
  // Opt the form out of Turbo before submitting, so this becomes an ordinary
  // browser navigation that waitForNavigation can track deterministically.
  //
  // Why: with Turbo the submit is a background fetch. Clicking and then calling
  // page.goto() races that fetch and cancels it, so no session is created. The
  // symptom looked like an account or server-capacity problem — whichever
  // accounts ran last in the loop failed, and different ones failed each run —
  // but eight sequential logins over plain curl all returned 302 then 200, so the
  // server was never at fault. Removing Turbo removes the race.
  await page.evaluate(() => {
    const form = document.querySelector('form[action*="sign_in"]');
    if (form) form.setAttribute('data-turbo', 'false');
  });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null),
    page.locator('form[action*="sign_in"] button[type="submit"]').first().click(),
  ]);

  if (/sign_in/.test(page.url())) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    return {
      page,
      ok: false,
      reason: /invalid email or password/i.test(body) ? 'credentials rejected' : 'no session established',
    };
  }

  await page.goto(`${ADMIN}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  return { page, ok: !/sign_in/.test(page.url()) };
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── §3.1 every admin account signs in, with the documented scope ─────────
  console.log('\n§3.1 Admin accounts');
  const SCOPES = {
    'admin@b-teka.com':       { can: ['/admin/products', '/admin/orders', '/admin/roles', '/admin/store/edit'], cannot: [] },
    'manager@b-teka.com':     { can: ['/admin/products', '/admin/orders', '/admin/promotions'], cannot: ['/admin/roles', '/admin/store/edit'] },
    'catalog@b-teka.com':     { can: ['/admin/products', '/admin/stock_items'], cannot: ['/admin/orders', '/admin/users', '/admin/roles'] },
    'fulfillment@b-teka.com': { can: ['/admin/orders', '/admin/users'], cannot: ['/admin/roles', '/admin/store/edit'] },
    'sales_b2b@b-teka.com':   { can: ['/admin/orders', '/admin/users', '/admin/price_lists'], cannot: ['/admin/roles'] },
    'support@b-teka.com':     { can: ['/admin/orders', '/admin/users'], cannot: ['/admin/stock_items', '/admin/roles', '/admin/store/edit'] },
    'spree@example.com':      { can: ['/admin/products'], cannot: [] },
  };

  for (const [email, scope] of Object.entries(SCOPES)) {
    const { ctx, page, ok, reason } = await httpLogin(browser, email);
    check(`sign in: ${email}`, ok, reason || '');
    if (ok) {
      if (email === 'admin@b-teka.com' || email === 'support@b-teka.com') {
        await shot(page, `admin-${email.split('@')[0]}-dashboard`);
      }
      for (const p of scope.can) {
        const r = await reachable(page, `${ADMIN}${p}`);
        check(`  ${email} can reach ${p}`, r);
      }
      for (const p of scope.cannot) {
        const r = await reachable(page, `${ADMIN}${p}`);
        check(`  ${email} blocked from ${p}`, !r);
        if (!r && email === 'catalog@b-teka.com' && p === '/admin/orders') {
          await shot(page, 'admin-catalog-blocked-from-orders');
        }
      }
    }
    if (ctx) await ctx.close();
  }

  // ── security: the sample-data default must be dead ───────────────────────
  console.log('\nSecurity');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${ADMIN}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="admin_user[email]"]', 'spree@example.com');
    await page.fill('input[name="admin_user[password]"]', 'spree123');
    await page.locator('form[action*="sign_in"] button[type="submit"]').first().click();
    await page.waitForTimeout(2600);
    await page.goto(`${ADMIN}/admin`, { waitUntil: 'domcontentloaded' });
    const blocked = /sign_in/.test(page.url());
    check('default password spree123 no longer works', blocked);
    await ctx.close();
  }

  // ── §4 public endpoints ───────────────────────────────────────────────────
  console.log('\n§4 URLs');
  {
    const api = await pwRequest.newContext();
    for (const [label, url, want] of [
      ['storefront home', `${SHOP}/`, 200],
      ['storefront listing', `${SHOP}/us/en/products`, 200],
      ['admin', `${ADMIN}/admin`, 200],
      ['health check', `${ADMIN}/up`, 200],
    ]) {
      const r = await api.get(url, { maxRedirects: 5, timeout: 40000 });
      check(`${label} responds ${want}`, r.status() === want, `got ${r.status()}`);
    }
    const jobs = await api.get(`${ADMIN}/jobs`, { maxRedirects: 0 }).catch(() => null);
    check('/jobs requires authentication', jobs && jobs.status() === 401, jobs ? `got ${jobs.status()}` : 'no response');

    // §3.3 + §10.2/10.3 API key behaviour
    console.log('\n§3.3 / §10 API keys');
    const okKey = await api.get(`${ADMIN}/api/v3/store/products?per_page=1`, { headers: { 'X-Spree-Api-Key': PK_ONLINE } });
    check('X-Spree-Api-Key (online channel) works', okKey.status() === 200, `got ${okKey.status()}`);

    const bearer = await api.get(`${ADMIN}/api/v3/store/products?per_page=1`, { headers: { Authorization: `Bearer ${PK_ONLINE}` } });
    check('Authorization: Bearer is rejected (401)', bearer.status() === 401, `got ${bearer.status()}`);

    const ws = await api.get(`${ADMIN}/api/v3/store/products?per_page=1`, { headers: { 'X-Spree-Api-Key': PK_WHOLESALE } });
    let code = '';
    try { code = (await ws.json())?.error?.code || ''; } catch { /* non-JSON */ }
    check('wholesale channel key gates anonymous access (401)', ws.status() === 401, `got ${ws.status()} ${code}`);

    // §6 catalogue counts
    const list = await api.get(`${ADMIN}/api/v3/store/products?per_page=1`, { headers: { 'X-Spree-Api-Key': PK_ONLINE } });
    const body = await list.json().catch(() => ({}));
    // Spree's pagination meta is {page, limit, count, pages, …} — `count` is the
    // total, not total_count.
    const total = body?.meta?.count ?? null;
    check('catalogue has 36 products', total === 36, `API reports ${total}`);
    await api.dispose();
  }

  // ── §3.2 storefront customer sign-in + the B2B pricing claim ─────────────
  console.log('\n§3.2 Storefront customers + B2B pricing');
  const signInShop = async (ctx, email) => {
    const page = await ctx.newPage();
    await page.goto(`${SHOP}/us/en/account`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.fill('input#email', email);
    await page.fill('input#password', PW);
    await page.locator('button:has-text("Sign In")').first().click();
    await page.waitForTimeout(6000);
    return page;
  };

  // retail baseline
  const ctxR = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rPage = await signInShop(ctxR, 'retail@b-teka.com');
  const retailIn = !/\/account\s*$/.test(rPage.url()) || !(await rPage.locator('input#password').count());
  check('retail@b-teka.com signs in on the storefront', retailIn, rPage.url());
  await shot(rPage, 'shop-retail-signed-in');
  await ctxR.close();

  // wholesale
  const ctxW = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wPage = await signInShop(ctxW, 'wholesale@example.com');
  const wholesaleIn = !(await wPage.locator('input#password').count());
  check('wholesale@example.com signs in on the storefront', wholesaleIn, wPage.url());
  await shot(wPage, 'shop-wholesale-signed-in');

  // ── the headline claim: 10+ units gives this customer the wholesale price ──
  // The price list matches ALL of {VolumeRule >= 10, CustomerGroupRule
  // Wholesale}, so the same customer should see retail at qty 1 and wholesale
  // at qty 10. Read the cart total rather than the product page, because the
  // volume rule only applies once the quantity is known.
  const money = (s) => {
    const m = (s || '').replace(/,/g, '').match(/\$\s*([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  };

  const cartTotal = async (page) => {
    await page.goto(`${SHOP}/us/en/cart`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const text = (await page.textContent('body')) || '';
    // "Subtotal" is the line-item total before shipping/tax.
    const m = text.match(/Subtotal[^$]*\$\s*([\d,.]+)/i);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  };

  const addToCart = async (page, qty) => {
    await page.goto(`${SHOP}/us/en/products`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const href = await page.locator('a[href*="/products/"]').first().getAttribute('href');
    await page.goto(new URL(href, SHOP).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const unit = money(await page.textContent('body'));
    // Bump quantity with the + control, then add once.
    for (let i = 1; i < qty; i++) {
      await page.locator('button[aria-label*="ncrease"], button:has-text("+")').first().click().catch(() => {});
      await page.waitForTimeout(120);
    }
    await page.locator('button:has-text("Add to Cart")').first().click();
    await page.waitForTimeout(5000);
    return { unit, href };
  };

  console.log('\nB2B pricing (the headline claim)');
  const { unit: listedUnit } = await addToCart(wPage, 10);
  const wholesaleSubtotal = await cartTotal(wPage);
  await shot(wPage, 'shop-wholesale-cart-qty10');

  // Same product, same quantity, as a retail customer.
  const ctxR2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rPage2 = await signInShop(ctxR2, 'retail@b-teka.com');
  await addToCart(rPage2, 10);
  const retailSubtotal = await cartTotal(rPage2);
  await shot(rPage2, 'shop-retail-cart-qty10');
  await ctxR2.close();

  console.log(`    listed unit price: ${listedUnit}`);
  console.log(`    wholesale subtotal @10: ${wholesaleSubtotal}`);
  console.log(`    retail subtotal @10:    ${retailSubtotal}`);

  check(
    'wholesale customer pays less than retail for the same 10 units',
    wholesaleSubtotal != null && retailSubtotal != null && wholesaleSubtotal < retailSubtotal,
    `wholesale $${wholesaleSubtotal} vs retail $${retailSubtotal}`
  );
  if (wholesaleSubtotal && retailSubtotal) {
    const off = Math.round((1 - wholesaleSubtotal / retailSubtotal) * 100);
    console.log(`    discount applied: ${off}%`);
  }

  await ctxW.close();
  await browser.close();

  // ── report ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`${results.length - failed.length}/${results.length} claims verified`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  ${f.claim}${f.detail ? ` — ${f.detail}` : ''}`));
  }
  console.log(`proof screenshots → docs/screenshots/verify/`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(2);
});
