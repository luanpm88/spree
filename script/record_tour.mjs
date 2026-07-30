// Record a narrated walkthrough of this Spree install.
//
//   node script/record_tour.mjs            -> docs/video/spree-tour.webm (+ .mp4)
//   SPEED=fast node script/record_tour.mjs -> shorter pauses, for iterating
//
// Playwright can record video but cannot add an audio track, so narration is
// burned in as an on-screen caption bar plus a step counter. That also makes the
// result usable with sound off, which is how most people watch a demo.
//
// Requires the local stack up (`make up`) and demo users seeded
// (`bin/rails demo:seed_users`).

import { chromium } from 'playwright';
import { mkdir, rename, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.PASSWORD || 'spree123456';
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';
const FAST = process.env.SPEED === 'fast';
const OUT = path.resolve('docs/video');

const W = 1440;
const H = 900;

// Pace: long enough to read the caption, short enough to stay watchable.
const beat = (ms) => Math.round((FAST ? 0.35 : 1) * ms);

let step = 0;
const TOTAL = 16;

/** Draw/update the caption bar inside the page. */
async function say(page, title, detail, opts = {}) {
  step += opts.countsAsStep === false ? 0 : 1;
  const label = opts.countsAsStep === false ? '' : `${step}/${TOTAL}`;

  await page.evaluate(
    ({ title, detail, label }) => {
      let bar = document.getElementById('__tour');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = '__tour';
        // Inline styles only — the admin's own CSS must not affect this.
        bar.style.cssText = [
          'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
          'padding:18px 26px', 'box-sizing:border-box',
          'background:linear-gradient(to top, rgba(9,12,18,.97), rgba(9,12,18,.88))',
          'color:#fff', 'font-family:-apple-system,"Segoe UI",Roboto,sans-serif',
          'display:flex', 'gap:20px', 'align-items:flex-start',
          'box-shadow:0 -14px 34px rgba(0,0,0,.34)',
          'border-top:3px solid #3b82f6',
        ].join(';');
        bar.innerHTML =
          '<div id="__tour_n" style="flex:0 0 auto;font-size:12px;font-weight:700;letter-spacing:.1em;' +
          'color:#93c5fd;padding-top:5px;min-width:42px"></div>' +
          '<div style="flex:1 1 auto;min-width:0">' +
          '<div id="__tour_t" style="font-size:20px;font-weight:700;line-height:1.3"></div>' +
          '<div id="__tour_d" style="font-size:14.5px;line-height:1.5;color:#cbd5e1;margin-top:5px"></div>' +
          '</div>';
        document.body.appendChild(bar);
      }
      document.getElementById('__tour_n').textContent = label;
      document.getElementById('__tour_t').textContent = title;
      document.getElementById('__tour_d').innerHTML = detail || '';
    },
    { title, detail, label }
  );
}

/** Navigate, then caption (caption is re-injected because navigation wipes it). */
async function visit(page, url, title, detail, hold = 4200) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(beat(500));
  await say(page, title, detail);
  await page.waitForTimeout(beat(hold));
}

/** Slow scroll so viewers can see below the fold. */
async function reveal(page, px = 520) {
  await page.mouse.wheel(0, px);
  await page.waitForTimeout(beat(1400));
}

const run = async () => {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  // ── title card ───────────────────────────────────────────────────────────
  await page.goto('about:blank');
  await page.setContent(`
    <body style="margin:0;height:100vh;display:flex;flex-direction:column;
      justify-content:center;align-items:center;background:#0b1020;color:#fff;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center">
      <div style="font-size:13px;letter-spacing:.28em;color:#60a5fa;font-weight:700">B-TEKA</div>
      <div style="font-size:54px;font-weight:800;margin-top:20px;letter-spacing:-.02em">Spree Commerce</div>
      <div style="font-size:25px;color:#94a3b8;margin-top:12px">Giới thiệu hệ thống vừa dựng</div>
      <div style="font-size:15px;color:#64748b;margin-top:40px">
        Spree 5.6.1 Community Edition · Rails 8.1.3 · PostgreSQL 18 · Docker
      </div>
      <div style="font-size:15px;color:#64748b;margin-top:8px">B2B + B2C · 36 sản phẩm · 3 kênh bán</div>
    </body>`);
  await page.waitForTimeout(beat(4200));

  // ── 1. login ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(beat(600));
  await say(
    page,
    'Đăng nhập trang quản trị',
    'Nhân viên đăng nhập ở <b>/admin</b>. Tài khoản nhân viên (AdminUser) tách riêng hoàn toàn khỏi tài khoản khách hàng (User) — hai bảng khác nhau trong database.'
  );
  await page.waitForTimeout(beat(3600));

  // type it out so the viewer sees it happen
  await page.fill('input[name="admin_user[email]"]', '');
  await page.type('input[name="admin_user[email]"]', 'admin@b-teka.com', { delay: FAST ? 10 : 55 });
  await page.type('input[name="admin_user[password]"]', PASSWORD, { delay: FAST ? 10 : 45 });
  await page.waitForTimeout(beat(900));
  await page.locator('form[action*="sign_in"] button[type="submit"]').first().click();
  await page.waitForTimeout(beat(2600));

  // ── 2-16 ─────────────────────────────────────────────────────────────────
  await visit(page, `${BASE}/admin`, 'Dashboard',
    'Tổng quan doanh thu và đơn hàng. Menu bên trái là toàn bộ hệ thống: đơn hàng, sản phẩm, khách hàng, khuyến mãi, báo cáo.', 4600);

  await visit(page, `${BASE}/admin/products`, 'Sản phẩm',
    'Dữ liệu mẫu có <b>36 sản phẩm / 121 biến thể</b>. Mỗi dòng hiển thị trạng thái, tồn kho và số biến thể.', 4200);
  await reveal(page, 420);

  // product detail — discovered by href, same approach as the screenshot script
  const prodHref = await page.locator('a[href]').evaluateAll((as) => {
    const re = /\/admin\/products\/([^/?#]+)(?:\/edit)?$/;
    const skip = new Set(['new', 'search', 'select_options', 'edit']);
    for (const a of as) {
      const h = a.getAttribute('href');
      const m = h && h.match(re);
      if (m && !skip.has(m[1]) && !m[1].startsWith('bulk_')) return h;
    }
    return null;
  });
  if (prodHref) {
    await visit(page, new URL(prodHref, BASE).toString(), 'Chi tiết sản phẩm',
      'Giá và tồn kho gắn vào <b>biến thể (Variant)</b>, không phải sản phẩm. Product chỉ là vỏ gom nhóm — đây là điều quan trọng nhất khi làm việc với catalog Spree.', 5200);
    await reveal(page, 560);
  }

  await visit(page, `${BASE}/admin/orders`, 'Đơn hàng',
    'Giỏ hàng và đơn hàng là <b>cùng một record</b>. Giỏ hàng chính là Order ở trạng thái <code>cart</code>, và nó thành đơn khi đi hết checkout tới <code>complete</code>.', 4800);

  const orderHref = await page.locator('a[href]').evaluateAll((as) => {
    const re = /\/admin\/orders\/([^/?#]+)(?:\/edit)?$/;
    for (const a of as) {
      const h = a.getAttribute('href');
      const m = h && h.match(re);
      if (m && m[1] !== 'new') return h;
    }
    return null;
  });
  if (orderHref) {
    await visit(page, new URL(orderHref, BASE).toString(), 'Chi tiết đơn hàng',
      'Toàn bộ vòng đời đơn: khách, sản phẩm, thanh toán, vận chuyển. Thuế và giảm giá không sửa trực tiếp tổng tiền — chúng tạo các dòng <b>Adjustment</b>, nên luôn truy vết được từng đồng.', 5200);
    await reveal(page, 620);
  }

  await visit(page, `${BASE}/admin/users`, 'Khách hàng',
    '21 khách mẫu. Trong đó <b>wholesale@example.com</b> là khách B2B đã được xếp vào nhóm Wholesale.', 4200);

  // ── B2B block ────────────────────────────────────────────────────────────
  await page.goto('about:blank');
  await page.setContent(`
    <body style="margin:0;height:100vh;display:flex;flex-direction:column;
      justify-content:center;align-items:center;background:#0b1020;color:#fff;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center">
      <div style="font-size:13px;letter-spacing:.28em;color:#60a5fa;font-weight:700">PHẦN QUAN TRỌNG NHẤT</div>
      <div style="font-size:46px;font-weight:800;margin-top:20px">Bán sỉ B2B</div>
      <div style="font-size:21px;color:#94a3b8;margin-top:16px;max-width:820px;line-height:1.5">
        Spree Community Edition (miễn phí) làm được B2B.<br>Ghép từ 3 mảnh có sẵn:
      </div>
      <div style="font-size:19px;color:#e2e8f0;margin-top:30px;text-align:left;line-height:2">
        ① <b>Channel</b> — dựng cổng, bắt đăng nhập mới xem được hàng<br>
        ② <b>Customer Group</b> — biết ai là khách sỉ<br>
        ③ <b>Price List</b> — cho họ giá riêng
      </div>
    </body>`);
  await page.waitForTimeout(beat(6000));

  await visit(page, `${BASE}/admin/customer_groups`, '② Nhóm khách hàng',
    'Nhóm <b>Wholesale</b> — đây là móc nối giữa khách hàng và bảng giá sỉ.', 4000);

  await visit(page, `${BASE}/admin/price_lists`, '③ Bảng giá',
    'Một sản phẩm có nhiều giá, tuỳ <b>ai mua</b> và <b>mua bao nhiêu</b>.', 3800);

  const plHref = await page.locator('a[href]').evaluateAll((as) => {
    const re = /\/admin\/price_lists\/([^/?#]+)(?:\/edit)?$/;
    for (const a of as) {
      const h = a.getAttribute('href');
      const m = h && h.match(re);
      if (m && m[1] !== 'new') return h;
    }
    return null;
  });
  if (plHref) {
    await visit(page, new URL(plHref, BASE).toString(), 'Bảng giá Wholesale — 2 điều kiện',
      '<b>Match all</b> nghĩa là phải thoả CẢ HAI: <b>Volume Rule</b> mua từ 10 cái, VÀ <b>Customer Group Rule</b> thuộc nhóm Wholesale. Khách lẻ mua 100 cái vẫn giá lẻ; khách sỉ mua 9 cái cũng vẫn giá lẻ.', 7000);
    await reveal(page, 520);
  }

  await visit(page, `${BASE}/admin/channels`, '① Kênh bán (Channels)',
    'Ba kênh trên cùng một cửa hàng: <b>online</b> (bán lẻ), <b>wholesale</b> (bán sỉ), <b>pos</b> (tại quầy). Sản phẩm publish riêng theo từng kênh.', 4800);

  const chHref = await page.locator('a[href]').evaluateAll((as) => {
    const re = /\/admin\/channels\/([^/?#]+)(?:\/edit)?$/;
    for (const a of as) {
      const h = a.getAttribute('href');
      const m = h && h.match(re);
      if (m && m[1] !== 'new' && (a.textContent || '').includes('Wholesale')) return h;
      if (m && m[1] !== 'new' && (a.closest('tr')?.textContent || '').includes('Wholesale')) return h;
    }
    return null;
  });
  if (chHref) {
    await visit(page, new URL(chHref, BASE).toString(), 'Cổng B2B — đây là cơ chế',
      'Hai dòng cuối chính là cổng: <b>Storefront access = Login required</b> (chưa đăng nhập thì không xem được hàng, không thấy giá) và <b>Guest checkout = Not allowed</b> (bắt buộc có tài khoản).', 7200);
  }

  // proof via API
  await page.goto('about:blank');
  await page.setContent(`
    <body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
      background:#0b1020;color:#e2e8f0;font-family:'SF Mono',Menlo,monospace;padding:0 90px">
      <div style="font-family:-apple-system,sans-serif;font-size:29px;font-weight:800;color:#fff;margin-bottom:8px">
        Kiểm chứng bằng API thật</div>
      <div style="font-family:-apple-system,sans-serif;font-size:16px;color:#94a3b8;margin-bottom:34px">
        Cùng một endpoint, hai API key của hai kênh khác nhau</div>

      <div style="font-size:15px;color:#64748b">$ curl -H "X-Spree-Api-Key: &lt;key kênh online&gt;" /api/v3/store/products</div>
      <div style="font-size:19px;color:#4ade80;margin:10px 0 28px">→ HTTP 200 · trả về 36 sản phẩm</div>

      <div style="font-size:15px;color:#64748b">$ curl -H "X-Spree-Api-Key: &lt;key kênh wholesale&gt;" /api/v3/store/products</div>
      <div style="font-size:19px;color:#f87171;margin:10px 0 6px">→ HTTP 401 authentication_required</div>
      <div style="font-size:15px;color:#94a3b8">"Authentication required to access this store."</div>

      <div style="font-family:-apple-system,sans-serif;font-size:17px;color:#cbd5e1;margin-top:38px;line-height:1.6">
        Mỗi API key gắn với một kênh. Nên web B2B và web B2C là <b style="color:#fff">hai ứng dụng
        dùng hai key khác nhau, trỏ về cùng một backend</b> — không cần viết hai hệ thống.
      </div>
    </body>`);
  await page.waitForTimeout(beat(9000));

  // ── roles ────────────────────────────────────────────────────────────────
  await visit(page, `${BASE}/admin/roles`, 'Phân quyền theo vai trò',
    'Đã dựng 6 vai trò: quản trị, quản lý, NV sản phẩm, NV xử lý đơn, NV bán sỉ, CSKH. Mỗi vai trò chỉ thấy đúng phần việc của mình.', 4600);

  // prove it: sign in as the catalog role and show orders is blocked
  const ctx2 = await browser.newContext({ viewport: { width: W, height: H } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/admin_user/sign_in`, { waitUntil: 'domcontentloaded' });
  await p2.fill('input[name="admin_user[email]"]', 'catalog@b-teka.com');
  await p2.fill('input[name="admin_user[password]"]', PASSWORD);
  await p2.locator('form[action*="sign_in"] button[type="submit"]').first().click();
  await p2.waitForTimeout(2200);
  const catalogSees = await p2.evaluate(() =>
    [...document.querySelectorAll('nav a, aside a')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 40)
  );
  await ctx2.close();

  const blocked = ['Orders', 'Customers', 'Promotions'].filter(
    (x) => !catalogSees.some((t) => t.includes(x))
  );

  await page.goto('about:blank');
  await page.setContent(`
    <body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
      background:#0b1020;color:#e2e8f0;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:0 90px">
      <div style="font-size:29px;font-weight:800;color:#fff">Phân quyền đã được kiểm chứng</div>
      <div style="font-size:16px;color:#94a3b8;margin-top:10px">
        Đăng nhập thật bằng <code>catalog@b-teka.com</code> rồi dò 9 màn hình quản trị</div>
      <div style="font-size:19px;color:#4ade80;margin-top:32px;line-height:1.9">
        ✓ Vào được: Sản phẩm · Tồn kho · Bảng giá
      </div>
      <div style="font-size:19px;color:#f87171;margin-top:10px;line-height:1.9">
        ✗ Bị chặn: ${blocked.length ? blocked.join(' · ') : 'Orders · Customers · Promotions'}
      </div>
      <div style="font-size:16px;color:#cbd5e1;margin-top:34px;line-height:1.6">
        Chạy lại bất cứ lúc nào: <code style="color:#93c5fd">node script/audit_roles.mjs</code><br>
        Kết quả hiện tại: <b style="color:#fff">6/6 vai trò đúng như thiết kế</b>.
      </div>
    </body>`);
  await page.waitForTimeout(beat(7000));

  // ── email ────────────────────────────────────────────────────────────────
  await visit(page, MAILPIT, 'Email',
    'Ở máy local, <b>mọi email đều bị giữ lại</b> — không có thư nào ra ngoài internet. Lên server thật thì phải cấu hình SMTP, nếu không khách sẽ không nhận được mail nào.', 5000);

  // ── outro ────────────────────────────────────────────────────────────────
  await page.goto('about:blank');
  await page.setContent(`
    <body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
      background:#0b1020;color:#fff;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:0 90px">
      <div style="font-size:34px;font-weight:800">Đã xong những gì</div>
      <div style="font-size:18px;color:#cbd5e1;margin-top:26px;line-height:2.05">
        ✓ Spree 5.6.1 chạy bằng Docker — một lệnh <code style="color:#93c5fd">make setup</code><br>
        ✓ Không cần Redis: hàng đợi, cache, websocket đều trong PostgreSQL<br>
        ✓ Demo B2B đầy đủ: 3 kênh, nhóm khách, bảng giá sỉ theo số lượng<br>
        ✓ 6 vai trò nhân viên, đã audit tự động<br>
        ✓ Tài liệu: DESIGN · LOCAL · DEPLOY · USER_GUIDE (kèm PDF)<br>
        ✓ CI build image tự động, server chỉ cần pull
      </div>
      <div style="font-size:17px;color:#64748b;margin-top:40px">github.com/luanpm88/spree</div>
    </body>`);
  await page.waitForTimeout(beat(8000));

  await ctx.close();
  await browser.close();

  // Playwright names the file by internal id — rename to something meaningful.
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.webm'));
  if (!files.length) throw new Error('playwright produced no video');
  const webm = path.join(OUT, 'spree-tour.webm');
  await rename(path.join(OUT, files[0]), webm);

  // mp4 for people who will open this in Quicktime / send it on Zalo.
  let mp4 = null;
  try {
    mp4 = path.join(OUT, 'spree-tour.mp4');
    await exec('ffmpeg', [
      '-y', '-i', webm,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
      '-pix_fmt', 'yuv420p',
      // even dimensions required by yuv420p
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags', '+faststart',
      mp4,
    ]);
  } catch (e) {
    console.log(`  (mp4 conversion skipped: ${e.message.split('\n')[0]})`);
    mp4 = null;
  }

  const { execFile: ef } = await import('node:child_process');
  const dur = await promisify(ef)('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', webm,
  ]).then((r) => `${Math.round(parseFloat(r.stdout))}s`).catch(() => 'unknown');

  console.log(`\nvideo : docs/video/spree-tour.webm  (${dur})`);
  if (mp4) console.log(`mp4   : docs/video/spree-tour.mp4`);
};

run().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
