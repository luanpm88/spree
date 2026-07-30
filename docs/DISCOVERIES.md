# Discoveries

Những thứ **không hiển nhiên**, đã phải trả giá bằng thời gian để biết. Mỗi mục ghi:
phát hiện được gì, tại sao lại thế, và bằng chứng.

Quy tắc của file này: chỉ ghi thứ đã **kiểm chứng trực tiếp** trên hệ thống đang chạy.
Chỗ nào chưa chắc thì ghi rõ `(chưa verify)`.

Lỗi thao tác hằng ngày → [LOCAL.md §5](LOCAL.md). Vận hành server → [DEPLOY.md §11](DEPLOY.md).

---

## 1. Về Spree

### 1.1 Spree 5 không có storefront cho Rails

Không có gem `spree_storefront`. `Gemfile` chỉ có `spree`, `spree_admin`,
`spree_emails`, `spree_dashboard`. Vào `/` là redirect sang `/admin` — **đúng thiết kế**,
không phải cấu hình sai.

Trang khách là app riêng gọi Store API. Dự án này dùng
[spree/storefront](https://github.com/spree/storefront) (Next.js 16, MIT).

### 1.2 B2B không cần Enterprise Edition

Cả cơ chế B2B nằm trong Community Edition, ghép từ 3 thứ có sẵn:

| | |
|---|---|
| `Spree::Channel` `preferences` | `storefront_access: "login_required"` + `guest_checkout: false` → cổng chặn |
| `Spree::CustomerGroup` | ai là khách sỉ |
| `Spree::PriceList` + `Spree::PriceRule` | giá riêng, 6 loại điều kiện |

6 loại `PriceRule` (verify bằng `Spree::PriceRule.descendants`):
`CustomerGroupRule`, `VolumeRule`, `ChannelRule`, `MarketRule`, `ZoneRule`, `UserRule`.

**Bằng chứng B2B chạy thật trên production** — cùng một sản phẩm, cùng 10 cái:

```
khách lẻ    : price = 879.99  → tổng 8,799.90
khách sỉ    : price = 527.99  → tổng 5,279.90     (giảm đúng 40%)
```

Lấy từ log server (`line_item.updated` webhook payload), không phải đọc từ UI.

### 1.3 API key gắn theo channel — đây là điểm kiến trúc quan trọng nhất

Mỗi `Spree::ApiKey` gắn được 1 channel. Nên web B2B và web B2C là **hai app dùng hai
key khác nhau, trỏ về cùng một backend**. Không cần fork, không if/else theo loại khách.

Kiểm chứng: gọi `/api/v3/store/products` bằng key channel `wholesale` khi chưa đăng nhập
→ `401 authentication_required`. Cùng endpoint với key channel `online` → `200`, 36 sản phẩm.

### 1.4 Store API dùng header riêng

```bash
X-Spree-Api-Key: pk_...      # ✅ 200
Authorization: Bearer pk_...  # ❌ 401
```

### 1.5 Giá và tồn kho ở Variant, không ở Product

Product chỉ là vỏ gom nhóm. Sản phẩm không có size/màu vẫn có 1 variant. Đây là câu trả
lời cho hầu hết câu hỏi "nhập giá ở đâu".

### 1.6 Phân quyền: tạo Role không cấp quyền gì

`Spree::Role` chỉ là cái tên. Quyền đến từ **permission set** khai báo trong
`config/initializers/spree.rb` (code, không phải UI). Role không có permission set →
đăng nhập được, không thấy gì.

14 permission set có sẵn (`Spree::PermissionSets::Base.descendants`).

### 1.7 Price Lists bị gate bởi `ProductDisplay`, không phải `ProductManagement`

**Hệ quả bảo mật:** vai trò chỉ-đọc (CSKH) **vẫn xem được giá sỉ**. Phát hiện bằng
`script/audit_roles.mjs`, không phải bằng đọc docs. Muốn chặn thì bỏ `ProductDisplay`
khỏi role đó.

### 1.8 `ProductManagement` không bao gồm quyền xem tồn kho

Role bán sỉ ban đầu không xem được Stock dù có `ProductManagement`. Phải thêm
`StockDisplay`. Không có gì trong tên permission set gợi ý điều này.

### 1.9 `spree:load_sample_data` tạo admin với mật khẩu mặc định công khai

Tạo `spree@example.com`, **full quyền admin**, mật khẩu `spree123` (mặc định công khai
của Spree). Trên site production mở internet, đây là lỗ hổng thật.

Phát hiện khi đối chiếu danh sách tài khoản với database thật thay vì tin vào tài liệu.
Đã đổi mật khẩu. **Không bao giờ chạy task này trên store thật.**

### 1.10 `config/recurring.yml` của spree_starter gọi method không tồn tại

`SolidCable::Message.prunable` → solid_cable 4.0.2 đổi tên thành `trimmable`.
Job lỗi **mỗi giờ**, bảng `solid_cable_messages` không bao giờ được dọn.

### 1.11 Không cần Redis

Solid Queue (job) + Solid Cache + Solid Cable đều nằm trong PostgreSQL. Job chạy trong
cùng process Puma (`SOLID_QUEUE_IN_PUMA`). Bớt hẳn một thành phần phải vận hành.

### 1.12 Deprecation cần để ý khi nâng Spree 6

```
Spree::Store.default returning a new unpersisted store when no default store
exists is deprecated and will be removed in Spree 6.0
```

---

## 2. Về Docker / môi trường

### 2.1 `docker --version` chạy được không có nghĩa daemon đang sống

Đó chỉ là CLI. Máy này có Colima cài sẵn nhưng chưa start.

### 2.2 Dockerfile của Spree bắt buộc BuildKit

Dùng `# syntax=docker/dockerfile:1` và `COPY --exclude=`. Compose v5 không tự có buildx
→ phải `brew install docker-buildx` rồi symlink vào `~/.docker/cli-plugins/`.

### 2.3 Puma kéo cả app chết khi database chưa có bảng

Puma chạy Solid Queue supervisor **trong cùng process**. DB trống → supervisor raise →
**Puma chết theo**. Hệ quả: `docker compose exec` vô dụng vì không có container nào sống.

Cách sửa: dùng `run --rm` (container dùng-một-lần) cho mọi lệnh database. Toàn bộ target
database trong `Makefile` đã làm vậy.

### 2.4 CSS admin là artifact build, và bị che 3 lớp

`/admin` lỗi 500 `asset 'spree/admin/application.css' not found` vì:

1. CSS admin là file **build ra**, ở `app/assets/builds/`
2. thư mục đó **bị gitignore** → clone về là rỗng
3. compose dev mount tmpfs lên `public/assets` → bản precompile trong image cũng bị che

Upstream mong bạn chạy `spree dev` (CLI npm) để nó chạy `Procfile.dev`. Dùng
`docker compose` trần thì không ai build CSS → đã thêm service `admin_css`.

### 2.5 Đường bị named volume che trong dev

`/rails/tmp`, `/rails/storage`, `/rails/public/assets`, `/usr/local/bundle`.
Viết file vào `tmp/` trên host thì **container không thấy**. Dùng `script/` hoặc pipe
qua stdin.

### 2.6 Healthcheck phải dùng `127.0.0.1`, không `localhost`

Trong image storefront, `/etc/hosts` chỉ có `::1 localhost`. Next bind IPv4 `0.0.0.0`.
→ `wget http://localhost:3001` = **connection refused**, container báo *unhealthy*
trong khi vẫn phục vụ traffic thật hoàn hảo.

```
localhost   → ::1        → refused
127.0.0.1               → 307 → 200 ✅
```

### 2.7 Cross-build arm64 → amd64 chạy được nhưng chậm

Máy dev Apple Silicon, server x86_64. `--platform linux/amd64` chạy qua giả lập.
Chỉ riêng stage `base` (apt install) đã ~3 phút. Đã bật buildx local layer cache để
lần sau nhanh hơn.

### 2.8 Storefront nung API URL vào lúc build

`SPREE_API_URL` và `SPREE_PUBLISHABLE_KEY` là **build-arg**, không phải biến runtime —
Next prerender trang bằng cách gọi API trong lúc build. Đổi backend = **build lại**.

Nguy hiểm: backend chết lúc build → ra image toàn trang lỗi mà **vẫn khởi động bình
thường**. `script/deploy` tự curl `/up` trước khi build.

### 2.9 pnpm có thể biến repo thành cache store của nó

`storefront/.pnpm-store/` đã xuất hiện với **38,477 file** chờ commit. Phải gitignore.

---

## 3. Về server dùng chung

### 3.1 Không bao giờ `swapoff` swap đang dùng trên máy RAM thấp

Kernel **OOM-kill chính tiến trình `swapoff` (128 KB)**, vì tắt swap buộc kéo 839 MB từ
swap về RAM mà không đủ chỗ:

```
Out of memory: Killed process 547003 (swapoff) ... anon-rss:128kB
```

Muốn thêm swap → **tạo file thứ hai** rồi `swapon`. Không sập gì cả.

### 3.2 Giới hạn RAM container thực sự bảo vệ được láng giềng

Lúc load sample data, container Spree bị **cgroup OOM giết 2 lần** (~1 GB RSS mỗi lần).
Quan trọng: đó là **cgroup** OOM, không phải host OOM — kernel giết Spree, **không giết
MySQL**. 28 site kia không bị ảnh hưởng, dữ liệu vẫn toàn vẹn.

`mysqld` được đặt `oom_score_adj=-800` để đảm bảo đúng thứ tự ưu tiên đó.

### 3.3 RAM đo thực tế của Spree

| | |
|---|---|
| bình thường | ~430–490 MB |
| xử lý ảnh | **~890 MB** |
| storefront | ~40–85 MB |
| PostgreSQL | ~35–60 MB |

Con số "~1 GB mỗi process Spree" trong `render.yaml` của Spree là đúng.

### 3.4 Docker bind `0.0.0.0` bỏ qua firewall

Docker chèn rule NAT **trước** ufw. Bind `0.0.0.0` là lộ app ra internet dù firewall bật.
Luôn bind `127.0.0.1` và để nginx làm lối vào duy nhất.

### 3.5 AWS chặn cổng 25 ra ngoài

SMTP phải dùng 587 hoặc 465.

---

## 4. Về công cụ tự động (Playwright, PDF)

Chi tiết cách dùng trong [TOOLING.md](TOOLING.md). Đây là các bài học.

### 4.1 Đừng bao giờ đoán URL rồi chụp ảnh

Đã chụp một trang "danh sách sản phẩm" hoá ra là **trang 404** — vì đoán
`/us/en/shop`, đường thật là `/us/en/products`. Ảnh 404 vẫn trông như ảnh thật và đã
lọt vào bản PDF gửi khách.

**Cách làm đúng:** đọc href từ navigation đang chạy, đừng hardcode đường đoán.

### 4.2 Click vào form Turbo bằng Playwright rất dễ race

Form đăng nhập admin do Turbo xử lý → submit là fetch nền. `click()` rồi `goto()` ngay
sẽ **huỷ fetch đó**, session không được tạo.

Triệu chứng cực dễ đọc sai: **tài khoản nào chạy cuối vòng lặp thì fail**, và mỗi lần
chạy lại fail một bộ khác. Ban đầu đã tưởng là giới hạn tài khoản hoặc server hết RAM.

**`(chưa giải quyết xong)`** — đã thử: chờ POST response, tắt Turbo bằng
`data-turbo="false"`, đăng nhập qua HTTP rồi bơm cookie vào browser. Cả ba vẫn còn
flaky ở 1–2 tài khoản cuối. Đăng nhập bằng tay trên browser **hoạt động bình thường**
(có ảnh chụp), và `script/audit_roles.mjs` chạy ổn với ít tài khoản hơn — nên đây là
vấn đề của harness, không phải của hệ thống.

### 4.3 Kiểm status code là chưa đủ — phải xem `Location`

Đã kết luận sai "8/8 login qua HTTP đều OK" vì chỉ xem `302`. Thực ra `302` đó
redirect **về lại `/admin_user/sign_in`** = Devise từ chối. Và `GET /admin` trả `200`
cả khi chưa đăng nhập (nó serve trang login), nên `200` cũng không chứng minh gì.

**Bài học: khi test auth, kiểm *đích đến*, đừng kiểm status code.**

### 4.4 Regex quá lỏng làm test nói dối

Dò "không có quyền" bằng `/authoriz/i` trên body → **mọi trang đều báo bị chặn**, vì
sidebar admin có mục **"Return Authorizations"**. Kết quả: `admin` trông như chỉ vào
được 2 trang.

Phải khớp đúng câu flash của CanCan: `/not authorized to (access|visit|perform)/i`.

### 4.5 Chromium in PDF cần chờ ảnh decode xong

Với ~25 ảnh nhúng base64, `waitUntil: 'load'` timeout ở mức mặc định 30 giây, và ảnh có
thể bị đo sai chiều cao. Phải chờ
`document.images.every(i => i.complete && i.naturalHeight > 0)`.

### 4.6 `page.evaluate` không thấy `require`/Node scope

Script chạy trong project mới resolve được `node_modules` — chạy file `.mjs` từ
`/tmp` thì `import 'playwright'` fail.

---

## 5. Còn treo

| | |
|---|---|
| Login qua Playwright còn flaky ở 1–2 tài khoản cuối | §4.2 — không ảnh hưởng người dùng thật |
| `spree@example.com` nên xoá khi go-live | §1.9 |
| Chưa cấu hình SMTP → khách không nhận được email | [DEPLOY.md §9](DEPLOY.md) |
| Chưa có cổng thanh toán VN (VNPay/MoMo) | phải tự viết `PaymentMethod` |
| Tiền tệ đang USD | đổi VND phải nhập lại giá |
| Luồng duyệt đơn B2B | bảng `OrderApproval` có sẵn, luồng phải tự code |
| Độ phủ bản dịch tiếng Việt | `spree_i18n` đã cài, chưa kiểm tra |
