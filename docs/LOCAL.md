# Local Development

Chạy Spree trên máy bạn bằng Docker. **Không cần cài Ruby trên host.**

- Spree là gì, kiến trúc → [DESIGN.md](DESIGN.md)
- Deploy production → [DEPLOY.md](DEPLOY.md)

---

## 1. Cần gì trước

| Thứ | Kiểm tra | Nếu thiếu |
|---|---|---|
| Docker **daemon đang chạy** | `docker info` | Docker Desktop / OrbStack, hoặc `colima start --cpu 4 --memory 8 --disk 30` |
| Plugin **buildx** | `docker buildx version` | `brew install docker-buildx` rồi symlink (xem §5.2) |
| Port 3000, 5433, 8025 rảnh | `make doctor` | đổi trong `.env` |
| ~6 GB đĩa | | image dev ~2.4 GB + Postgres |

Chạy `make doctor` — nó kiểm tra hết và in cách sửa.

> Ruby trên máy bạn **không liên quan**. Máy này có Ruby 2.6 (bản hệ thống của macOS)
> trong khi Spree cần Ruby 4.0.1 — vẫn chạy tốt vì mọi thứ ở trong container.

---

## 2. Lần đầu

```bash
make setup
```

Một lệnh, ~10 phút (chủ yếu là build image). Nó làm tuần tự:

| Bước | Làm gì |
|---|---|
| `env` | tạo `.env` + sinh `SECRET_KEY_BASE` |
| `build` | build image dev |
| `up` | chạy postgres + mailpit + web + admin_css |
| `db-prepare` | tạo DB, migrate, seed (quốc gia, tỉnh, role…) |
| `css` | **build Tailwind cho admin — bỏ bước này là `/admin` lỗi 500** |
| `sample-data` | catalog demo + khách + đơn + **dữ liệu B2B wholesale** |
| `admin` | tạo admin user |
| `api-key` | in publishable API key |

Xong thì mở:

| | URL | Đăng nhập |
|---|---|---|
| **Cửa hàng (khách mua)** | http://localhost:3001 | — |
| Admin | http://localhost:3000/admin | `admin@b-teka.com` / `spree123456` |
| Hộp thư (bắt hết mail) | http://localhost:8025 | — |
| Job queue | http://localhost:3000/jobs | `spree` / `spree123` |
| Health | http://localhost:3000/up | — |

Tài khoản có trong sample data:

| Email | Là gì |
|---|---|
| `spree@example.com` | admin của sample data |
| `wholesale@example.com` | khách **B2B**, thuộc nhóm `Wholesale` |

---

## 3. Dùng hàng ngày

```bash
make up          # chạy
make down        # tắt (giữ database)
make logs        # xem log web   (make logs S=postgres cho service khác)
make ps          # trạng thái container
make console     # rails console
make psql        # psql vào DB dev
make sh          # bash trong container
make test        # rspec
make mail        # gửi mail thử + xem Mailpit nhận chưa
make reset       # XOÁ SẠCH volume rồi setup lại
make help        # xem hết
```

Sửa code Ruby → **có hiệu lực ngay**, không cần restart (source được bind-mount).
Sửa `Gemfile` hoặc `Dockerfile` → `make build && make up`.

---

## 4. Cấu hình

### `.env`

Không commit (đã có trong `.gitignore`). `make env` tự sinh.

Bắt buộc:

```bash
SECRET_KEY_BASE=<64 byte hex>    # make env tự sinh
```

Hay dùng:

```bash
SPREE_PORT=3000        # port web trên host
SPREE_DB_PORT=5433     # Postgres ra host (5433 để không đụng Postgres cài sẵn)
MAILPIT_UI_PORT=8025
RAILS_FORCE_SSL=false  # local là HTTP
JOB_THREADS=10         # dev chạy nhiều thread cho import/resize ảnh nhanh
```

### Email ở local

**Không có mail nào ra ngoài internet.** Compose trỏ `SMTP_HOST` vào container
`mailpit`, mọi mail Spree gửi đều bị bắt lại, xem ở http://localhost:8025.

Kiểm tra: `make mail`.

Muốn gửi thật (test SMTP provider) → set trong `.env`:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=apikey
SMTP_PASSWORD=...
SMTP_FROM_ADDRESS=store@b-teka.com
```

Rồi `make up` và `docker compose -f docker-compose.dev.yml exec web \
bin/rails runner script/smoke_mail.rb ban@email.com`.

### Kiến trúc container

```
web         Puma (Rails) + Solid Queue supervisor CHUNG 1 process
postgres    Postgres 18 — chứa cả data, job queue, cache, cable
storefront  Next.js 16 — cửa hàng khách mua, gọi Store API của web
mailpit     bắt mail
admin_css   watcher build Tailwind cho admin
```

### Storefront (cửa hàng cho khách)

Spree 5 **không có storefront cho Rails**, nên trang khách mua là một app riêng:
[spree/storefront](https://github.com/spree/storefront) (Next.js 16, MIT), đã vendor
sẵn vào thư mục `storefront/`.

Ở local nó chạy **`pnpm dev`**, không phải bản build. Lý do: image production
*prerender* các trang bằng cách gọi Spree API **lúc build** (xem
`storefront/Dockerfile`), nên nếu dùng bản build thì đổi nội dung nào cũng phải build
lại. Dev mode gọi API theo từng request và hot-reload.

```bash
docker compose -f docker-compose.dev.yml logs -f storefront   # xem log
docker compose -f docker-compose.dev.yml restart storefront
```

Nó cần `SPREE_PUBLISHABLE_KEY` trong `.env` — lấy bằng `make api-key`.

> **Lần khởi động đầu chậm** (vài phút): container phải `pnpm install` rồi Next.js
> biên dịch lần đầu. Trang đầu tiên có thể mất 10–20 giây. Những lần sau nhanh vì
> `node_modules` và `.next` nằm trong Docker volume.

> `node_modules` và `.next` **cố tình để trong named volume**, không dùng bind mount —
> container là Alpine/musl còn máy bạn là macOS/arm64, dùng chung thư mục sẽ hỏng
> native module.

**Không có Redis, không có worker riêng.** Solid Queue chạy job ngay trong Puma
(`SOLID_QUEUE_IN_PUMA`), queue nằm trong Postgres. Đây là lý do stack nhẹ.

---

## 5. Những lỗi đã gặp và cách sửa

> Ghi lại thật để lần sau không mất thời gian. Tất cả đều là lỗi **thật** đã gặp khi
> dựng project này.

### 5.1 `docker` có nhưng daemon không chạy

```
failed to connect to the docker API at unix:///var/run/docker.sock
```

`docker --version` chạy được **không có nghĩa là daemon sống** — đó chỉ là CLI. Máy này
có Colima cài rồi nhưng chưa start.

```bash
colima start --cpu 4 --memory 8 --disk 30
```

### 5.2 Thiếu buildx → build fail

```
Docker Compose requires buildx plugin to be installed
```

Dockerfile của Spree dùng `# syntax=docker/dockerfile:1` và `COPY --exclude=…` → **bắt
buộc BuildKit**. Compose v5 không tự có buildx.

```bash
brew install docker-buildx
mkdir -p ~/.docker/cli-plugins
ln -sfn /opt/homebrew/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx
docker buildx version   # xác nhận
```

### 5.3 Colima không tải được image (timeout)

```
error downloading 'ubuntu-24.04-minimal-cloudimg-arm64-docker.qcow2': connection timed out
```

Mạng chặn/chậm khi tải VM image từ GitHub release. Chạy lại `colima start` (nó resume),
hoặc đổi mạng/VPN. Không phải lỗi cấu hình.

### 5.4 `web` crash-loop trên DB mới — **cái này quan trọng**

Clone mới, `docker compose up` → container `web` chết ngay:

```
ActiveRecord::NoDatabaseError: Database not found: spree_development
Detected Solid Queue has gone away, stopping Puma...
```

**Nguyên nhân:** Puma khởi động Solid Queue supervisor *trong cùng process*. DB chưa có
bảng → supervisor raise → **nó kéo Puma chết theo**.

**Hệ quả:** `docker compose exec web …` vô dụng (không có container nào để attach).

**Cách sửa:** dùng container dùng-một-lần, không phải `exec`:

```bash
docker compose -f docker-compose.dev.yml run --rm web bin/rails db:prepare
```

Vì thế **mọi target database trong `Makefile` đều dùng `run --rm`, không dùng `exec`**.

### 5.5 `/admin` lỗi 500: thiếu CSS

```
The asset 'spree/admin/application.css' was not found in the load path
```

**Nguyên nhân (3 lớp cùng lúc):**

1. CSS admin là file **build ra**, ở `app/assets/builds/spree/admin/application.css`.
2. Thư mục đó **bị gitignore** (`/app/assets/builds/*`) → clone về là rỗng.
3. Compose dev bind-mount source đè lên `/rails`, **và** mount tmpfs rỗng lên
   `/rails/public/assets` → bản precompile trong image bị che nốt.

Upstream `spree_starter` mong bạn chạy `spree dev` (CLI npm) để nó chạy `Procfile.dev`,
trong đó có dòng `admin_css`. Dùng `docker compose` trần thì không ai chạy watcher đó.

**Cách sửa:** `make css` (build 1 lần). Và repo này **đã thêm service `admin_css`** vào
`docker-compose.dev.yml` — không có trong upstream — để `make up` là tự có watcher.

### 5.6 Host `tmp/` không thấy trong container

Viết file vào `tmp/` trên máy host rồi `bin/rails runner tmp/x.rb` → *"file could not be
found"*.

**Nguyên nhân:** compose mount **named volume** `tmp_cache:/rails/tmp`, che mất
bind-mount của host.

**Cách sửa:** để script ở chỗ khác (`script/` chạy tốt), hoặc pipe qua stdin:

```bash
docker compose -f docker-compose.dev.yml exec -T web bin/rails runner - <<'RUBY'
puts Spree.version
RUBY
```

Các đường bị che trong dev: `/rails/tmp`, `/rails/storage`, `/rails/public/assets`,
`/usr/local/bundle`.

### 5.7 `ActionMailer::Base.mail` không gọi được

`undefined method 'mail' for class ActionMailer::Base` — method này không public.
Dùng `Mail.new` + gán delegate SMTP, xem [`script/smoke_mail.rb`](../script/smoke_mail.rb).

### 5.8 `/dashboard` trả 404 ở local

**Bình thường.** React dashboard chỉ được bake vào *final stage* của Dockerfile
(`SPREE_DASHBOARD_DIST_PATH`); compose dev build tới `target: dev` nên không có.
Dev thì dùng `/admin`.

### 5.9 Store API 401 dù đã có API key

`Authorization: Bearer <key>` → **401**. Store API dùng header riêng:

```bash
curl -H "X-Spree-Api-Key: pk_..." http://localhost:3000/api/v3/store/products
```

### 5.10 API key channel Wholesale trả 401 dù sản phẩm đã publish

```json
{"error":{"code":"authentication_required","message":"Authentication required to access this store."}}
```

**Không phải lỗi.** Channel `wholesale` có `storefront_access: "login_required"` — đây
là *cổng B2B*, đúng thiết kế. Xem [DESIGN.md §4](DESIGN.md#4-b2b-vs-b2c--phần-quan-trọng-nhất).

### 5.11 Cảnh báo deprecation lúc seed

```
Spree::Store.default returning a new unpersisted store when no default store exists
is deprecated and will be removed in Spree 6.0
```

Vô hại ở lần seed đầu (chưa có store nào). Nhưng **đáng nhớ khi nâng lên Spree 6** — lúc
đó phải chắc chắn có default store trước khi gọi `Store.default`.

---

## 6. Test

```bash
make test                                   # cả bộ
make sh
  bundle exec rspec spec/models/            # chỉ model
  bundle exec rspec spec/models/x_spec.rb   # 1 file
```

Test chạy trên database `spree_test` riêng. Compose dev cố tình set `DATABASE_HOST`
(chứ **không** `DATABASE_URL`) — vì `DATABASE_URL` sẽ override mọi Rails env và làm
rspec chạy vào DB dev.

Lần đầu: `docker compose -f docker-compose.dev.yml run --rm web bin/rails db:test:prepare`.

---

## 7. Đổi Spree version

```bash
# sửa Gemfile
make build
make up
docker compose -f docker-compose.dev.yml run --rm web bin/rails db:migrate
docker compose -f docker-compose.dev.yml run --rm web bin/rails spree:upgrade
make css      # CSS admin có thể đổi theo version
```

`spree:upgrade` chạy các task post-deploy của version mới — **đừng bỏ**.
