# Deploy

Cách deploy Spree lên production, và toàn bộ khảo sát hạ tầng phía sau nó.

**Không dùng CI.** Mọi thứ chạy qua `script/deploy` từ máy bạn. Lý do và cách dùng ở
[§3](#3-script-deploy--công-cụ-duy-nhất).

- Spree là gì, kiến trúc → [DESIGN.md](DESIGN.md)
- Chạy trên máy cá nhân → [LOCAL.md](LOCAL.md)
- Bàn giao cho khách → [HANDOVER.md](HANDOVER.md)

**Trạng thái: đang chạy production.** https://spree.b-teka.com/admin ·
https://shop.b-teka.com

---

## 1. Tóm tắt

```bash
script/deploy doctor            # máy mình + server đã sẵn sàng chưa
script/deploy ship backend      # build → đẩy qua SSH → release
script/deploy status            # đang chạy gì, RAM, job lỗi
script/deploy logs web          # xem log
script/deploy rollback sha-…    # quay lại bản trước
```

Chỉ có 3 việc thường làm: **ship** (đưa code mới lên), **status** (xem tình hình),
**logs** (khi có gì lạ).

---

## 2. Kiến trúc

```
   Máy bạn                                Server 54.169.34.13
   ┌──────────────────────┐               ┌──────────────────────────────────┐
   │ docker buildx        │               │ nginx :80/:443 (dùng chung 28 site)│
   │   --platform amd64   │               │   spree.b-teka.com ─┐            │
   │        │             │               │   shop.b-teka.com ──┼─┐          │
   │        ▼             │  docker save  │                     │ │          │
   │   image amd64  ──────┼──── | ssh ───►│  127.0.0.1:3010 ◄───┘ │  web      │
   │                      │   docker load │  127.0.0.1:3011 ◄─────┘  storefront│
   └──────────────────────┘               │        │                          │
                                          │        ▼  postgres (volume)       │
                                          └──────────────────────────────────┘
```

**Server không bao giờ build.** Máy này chỉ còn ~300 MB RAM trống và đang chạy MySQL +
PHP-FPM cho ~28 website khác; build image Spree cần ~2 GB. Build ở đó là swap nặng và
có nguy cơ OOM kéo các site khác chết theo.

**Container chỉ mở trên `127.0.0.1`.** nginx là lối vào duy nhất. Nếu bind `0.0.0.0`,
Docker chèn rule NAT **trước** ufw → app lộ thẳng ra internet dù firewall đang bật.

---

## 3. `script/deploy` — công cụ duy nhất

### Vì sao bỏ CI

Trước đây dùng GitHub Actions. Đã bỏ vì:

- **Không kiểm soát được lúc cần.** Deploy trên một server nhỏ dùng chung cần *xem*
  từng bước: RAM còn bao nhiêu, 28 site kia còn sống không. CI thì bấm rồi chờ.
- **Cần token mà project không có.** Đẩy image lên GHCR cần PAT scope `write:packages`.
  Thêm một secret phải quản lý chỉ để deploy một server là không đáng.
- **Chậm và khó debug.** Sửa một dòng cũng phải commit → chờ CI → mới biết đúng sai.

`script/deploy` chạy từ máy bạn, in ra từng bước, và **dừng lại thay vì để server ở
trạng thái nửa vời**.

### Hai đường đưa image lên

| | Cần gì | Khi nào dùng |
|---|---|---|
| **`ship`** ⭐ | không cần gì | mặc định — build rồi stream qua SSH |
| `push` + `release` | token `write:packages` | khi có nhiều server cùng pull một image |

`ship` = `build` + `docker save | gzip | ssh docker load` + `release`. Không registry,
không token, không đăng nhập gì cả.

### Toàn bộ lệnh

```
Hằng ngày
  status                 đang chạy gì, version, RAM, job lỗi
  logs [service]         xem log (mặc định web; LINES=n để đổi số dòng)
  release [svc]          backup → pull → up → health → verify
  restart [service]

Đưa code mới lên
  ship [target]          build → stream qua SSH → release   (không cần registry)
  build [target]         chỉ build, giữ image ở máy
  push [target]          đẩy lên registry (cần write:packages)

Cứu hộ
  releases               commit gần đây + backup trên server
  rollback sha-<commit>  về image cũ (KHÔNG hoàn nguyên migration)

Truy cập
  console                Rails console        psql   PostgreSQL
  shell                  bash trong container

Cài đặt / kiểm tra
  doctor                 máy mình + server sẵn sàng chưa
  setup                  chuẩn bị server lần đầu (Docker, .env, swap, chống OOM)
  neighbours             sức khoẻ 28 site dùng chung máy
  verify                 kiểm tra end-to-end mọi thứ ghi trong HANDOVER
```

`target` = `backend` | `storefront` | `all`.
`svc` = tên service trong compose: `web` | `storefront` | `postgres` | `all`.

> **`backend` và `web` là hai tên khác nhau.** `backend` là *build target*, `web` là
> *compose service*. `script/deploy release backend` sẽ báo lỗi và nhắc dùng `web` —
> cố tình như vậy để không im lặng chạy sai.

### Cấu hình

Mặc định đã đúng cho server hiện tại. Muốn đổi thì tạo `deploy.env` (đã gitignore):

```bash
SSH_HOST=ubuntu@54.169.34.13
SPREE_API_URL=https://spree.b-teka.com
SPREE_PUBLISHABLE_KEY=pk_...        # BẮT BUỘC khi build storefront
```

---

## 4. Build chéo kiến trúc (cross-build)

Máy dev là **Apple Silicon (arm64)**, server là **x86_64**. Nên phải build
`--platform linux/amd64`, chạy qua giả lập (emulation) → **chậm**.

Giảm đau bằng **buildx local layer cache** (`~/.cache/spree-buildx`):

| Lần build | Thời gian |
|---|---|
| Lần đầu | chậm — `bundle install` + biên dịch asset đều chạy giả lập |
| Sửa code Ruby/view | nhanh hơn nhiều — chỉ làm lại từ layer `COPY` trở đi |
| Sửa `Gemfile` | chậm lại — phải `bundle install` lại |

> Cache nằm ở máy bạn, không chia sẻ. Máy khác build lần đầu vẫn chậm.

### Storefront nung API URL vào lúc build

`storefront/Dockerfile` **prerender** trang bằng cách gọi Spree API **trong lúc
build**. Hệ quả:

- `SPREE_API_URL` và `SPREE_PUBLISHABLE_KEY` là **build-arg**, không phải biến runtime.
- Đổi backend mà storefront trỏ tới → **build lại**, không phải sửa `.env`.
- Backend **phải đang sống** lúc build. `script/deploy` tự `curl $SPREE_API_URL/up`
  trước khi build và dừng nếu chết — nếu không sẽ ra image toàn trang lỗi mà vẫn
  chạy bình thường, rất khó phát hiện.

---

## 5. `release` làm gì

Thứ tự này có chủ ý:

1. **Kiểm tra `.env`** trên server — không có thì dừng ngay.
2. `git fetch` + `reset --hard origin/main` — code trên server khớp git.
3. **Backup database** ra `backups/pre-deploy-<timestamp>.sql.gz`, giữ 7 bản gần nhất.
   → **Phải làm TRƯỚC khi container mới lên**, vì migration chạy từ entrypoint của
   image; container lên là schema đã đổi rồi. `pg_dump` fail → dừng, không deploy.
4. Pull image (hoặc bỏ qua nếu vừa `ship`).
5. `up -d --remove-orphans`.
6. **Chờ health** ở `127.0.0.1:3010/up`, tối đa ~200 giây. Không lên thì in 60 dòng
   log cuối và **thoát khác 0**.
7. Kiểm tra từ internet thật: `/up`, `/admin`, storefront.
8. **Kiểm tra lại 28 site kia** — điều đáng quan tâm nhất sau khi động vào máy này.
9. Dọn image cũ hơn 7 ngày.

---

## 6. Khảo sát server

Đo trực tiếp qua SSH, 30/07/2026.

| | |
|---|---|
| OS | Ubuntu 24.04 LTS |
| Kernel | 6.17.0-1019-**aws** → EC2, ap-southeast-1 |
| Kiến trúc | **x86_64** |
| RAM | **1907 MB tổng**, thường còn **~300 MB** |
| Swap | 6 GB (`/swapfile` 4G + `/swapfile2` 2G) |
| Đĩa | 58 GB, còn ~15 GB |
| Docker | 29.6.2 |
| nginx | 1.24.0, TLS do certbot quản lý |

### Máy này không trống

```
mysqld                    ~20% RAM   ← tiến trình lớn nhất
php-fpm: shopcuaban_vn, sattanhung_com, Guucoffee_com, luathuynhgia_com, …
nginx (3 worker)          giữ cổng 80/443
```

~28 vhost, có site khách hàng thật: `shopcuaban.vn`, `sattanhung.com`,
`luathuynhgia.com`, `Guucoffee.com`, `nitrasa.vn`, `bialo.vn`, `acellemail.b-teka.com`…

Stack là **LEMP** (nginx + MySQL + PHP-FPM). Spree là Rails + PostgreSQL → tách biệt
hoàn toàn về dữ liệu, **nhưng dùng chung RAM**.

### DNS & TLS

```
spree.b-teka.com → 54.169.34.13 ✅
shop.b-teka.com  → 54.169.34.13 ✅
```

Cả hai đã có cert Let's Encrypt, certbot tự gia hạn.

---

## 7. Chuyện RAM — đã xảy ra thật

Tài liệu chính thức của Spree ghi một tiến trình Spree cần **~1 GB**. Đo thực tế:

| | |
|---|---|
| Spree lúc bình thường | ~430–490 MB |
| Spree lúc xử lý ảnh | **~890 MB** |
| Storefront (Next.js) | ~40–85 MB |
| PostgreSQL | ~35–60 MB |

**Sự cố đã xảy ra:** lúc chuẩn bị deploy, chỉ vì chạy `swapoff` để mở rộng swap,
kernel đã **OOM-kill chính tiến trình `swapoff` (128 KB)** — vì tắt swap buộc phải kéo
839 MB từ swap về RAM mà không đủ chỗ.

> **Bài học: không bao giờ `swapoff` file swap đang dùng trên máy này.** Muốn thêm
> swap thì **tạo file thứ hai** (`/swapfile2`) rồi `swapon`. `script/deploy setup`
> làm đúng như vậy.

**Sự cố thứ hai:** lúc `spree:load_sample_data`, container Spree bị **cgroup OOM giết 2
lần** (~1 GB RSS mỗi lần) khi xử lý ảnh. Đây là **giới hạn container hoạt động đúng** —
nó giết Spree chứ không giết MySQL, 28 site kia không hề bị ảnh hưởng. Dữ liệu vẫn
toàn vẹn, 4 job ảnh bị lỗi và retry xong.

### Các biện pháp đang áp dụng

```
swap                    6 GB, vm.swappiness=10
giới hạn container      web 1200M · postgres 512M · storefront 420M
PostgreSQL              shared_buffers=128MB, max_connections=40
Puma                    WEB_CONCURRENCY=1, RAILS_MAX_THREADS=3, JOB_THREADS=2
mysqld oom_score_adj    -800  ← quan trọng nhất
docker log              json-file, max 10 MB × 3
```

`oom_score_adj=-800` cho `mysqld` nghĩa là: **hết RAM thì kernel giết container
Spree/storefront trước, không giết MySQL của 28 site kia.** Áp dụng ngay qua `/proc`
(không cần restart MySQL) và persist qua systemd drop-in cho lần khởi động sau.

> **Khuyến nghị: tách Spree sang máy riêng ≥2 GB, hoặc nâng máy này lên 4 GB.**
> Cấu hình hiện tại đủ cho demo/UAT, không nên chạy thật lâu dài.

---

## 8. Chuẩn bị server lần đầu

```bash
script/deploy setup      # Docker, checkout, .env, swap, chống OOM
```

Rồi cài nginx vhost bằng tay (cố tình không tự động — sai một dòng là 28 site sập):

```bash
sudo cp deploy/nginx/spree.b-teka.com.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/shop.b-teka.com.conf  /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/spree.b-teka.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/shop.b-teka.com  /etc/nginx/sites-enabled/
sudo nginx -t                    # BẮT BUỘC pass mới được reload
sudo systemctl reload nginx
sudo certbot --nginx -d spree.b-teka.com
sudo certbot --nginx -d shop.b-teka.com
```

`nginx -t` fail → **xoá symlink rồi reload lại**, đừng cố sửa khi đang lỗi.

Tạo dữ liệu ban đầu:

```bash
script/deploy console
# hoặc:
ssh ubuntu@54.169.34.13 'cd ~/spree && docker compose -f docker-compose.prod.yml exec \
  -T -e EMAIL=admin@b-teka.com -e PASSWORD="..." web bin/rails spree:cli:create_admin'
```

### Repo private → server cần deploy key

```bash
ssh ubuntu@54.169.34.13 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519_spree'
# rồi thêm public key vào GitHub → repo → Settings → Deploy keys (read-only)
gh repo deploy-key add key.pub --repo luanpm88/spree --title "prod server"
```

Server dùng SSH alias `github-spree` trong `~/.ssh/config` để chọn đúng key.

---

## 9. Email — chưa cấu hình

**Demo thì không cần.** Chỉ xem shop và admin thì email không liên quan; chỗ duy nhất
thiếu là reset mật khẩu, mà mật khẩu đã bàn giao sẵn và admin đổi được bằng console.

**Bán thật thì bắt buộc.** `SMTP_HOST` đang rỗng → Spree chỉ ghi mail vào log, khách
không nhận được gì: không có mail xác nhận đơn, không reset được mật khẩu, không mời
được admin.

```bash
SMTP_HOST=            # vd smtp.sendgrid.net
SMTP_PORT=587         # KHÔNG dùng 25 — AWS chặn cổng 25 ra ngoài
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_ADDRESS=store@b-teka.com
```

| Nhà cung cấp | Ghi chú |
|---|---|
| SendGrid / Mailgun / Brevo | free tier ~100 mail/ngày |
| Amazon SES | rẻ nhất khi volume lớn, cùng region, phải xin ra khỏi sandbox |
| Gmail SMTP | **đừng dùng cho production** |

Kiểm tra:

```bash
ssh ubuntu@54.169.34.13 'cd ~/spree && docker compose -f docker-compose.prod.yml \
  exec web bin/rails runner script/smoke_mail.rb ban@email.com'
```

Thêm **SPF + DKIM + DMARC** cho domain gửi, thiếu là gần như chắc chắn vào spam.

---

## 10. Vận hành

### Backup

`release` chỉ backup **lúc deploy**. Cần cron riêng:

```bash
0 3 * * * cd /home/ubuntu/spree && docker compose -f docker-compose.prod.yml exec -T \
  postgres pg_dump -U postgres spree_production | gzip > backups/daily-$(date +\%F).sql.gz \
  && find backups -name 'daily-*.sql.gz' -mtime +14 -delete
```

Đĩa còn ~15 GB → **nên đẩy backup ra ngoài** (S3/R2).

Nhớ backup cả volume `storage_data` (ảnh sản phẩm) — `pg_dump` không có ảnh:

```bash
docker run --rm -v spree_storage_data:/data -v $PWD/backups:/b alpine \
  tar czf /b/storage-$(date +%F).tar.gz -C /data .
```

### Restore

```bash
gunzip -c backups/pre-deploy-XXX.sql.gz | docker compose -f docker-compose.prod.yml \
  exec -T postgres psql -U postgres spree_production
```

### Rollback

```bash
script/deploy releases
script/deploy rollback sha-<12 ký tự>
```

> Rollback image **không hoàn nguyên migration**. Nếu bản mới có migration phá vỡ
> tương thích thì phải restore từ `backups/`.

---

## 11. Ghi chú tích luỹ

Những thứ đã trả giá để biết.

1. **Server là máy production dùng chung, không phải máy trống.** Luôn `nginx -t`
   trước khi reload. Luôn `script/deploy neighbours` sau khi deploy.
2. **Không build trên server.** Cần ~2 GB.
3. **Không `swapoff` swap đang dùng.** Đã bị OOM-kill vì việc này (§7). Thêm file thứ hai.
4. Server **x86_64**, máy dev **arm64** → image local và prod **khác kiến trúc**, không
   dùng lẫn được. Luôn `--platform linux/amd64`.
5. `RAILS_ASSUME_SSL=true` + `RAILS_FORCE_SSL=false` khi có nginx đứng trước.
   `FORCE_SSL=true` → **redirect vô hạn**.
6. Bind `127.0.0.1`, không bao giờ `0.0.0.0` — Docker chèn NAT trước ufw.
7. `RAILS_HOST` sai → link trong email và URL ảnh trong API sai. Không báo lỗi, chỉ là
   link hỏng.
8. **Migration chạy từ entrypoint image** → backup phải làm TRƯỚC. `release` đúng thứ tự.
9. **Cổng 25 bị AWS chặn** → SMTP phải 587/465.
10. Không cần Redis — Solid Queue/Cache/Cable đều trong PostgreSQL.
11. **Healthcheck phải dùng `127.0.0.1`, không dùng `localhost`.** Trong image
    storefront, `/etc/hosts` chỉ map `localhost → ::1` còn Next bind IPv4 → healthcheck
    báo *unhealthy* trong khi web vẫn chạy hoàn hảo. Đã mất thời gian vì lỗi này.
12. **`spree:load_sample_data` tạo admin `spree@example.com` với mật khẩu mặc định
    `spree123`.** Full quyền admin. **Không bao giờ chạy task này trên store thật.**
    Xem [HANDOVER.md §3.1](HANDOVER.md).
13. `config/recurring.yml` của spree_starter gọi `SolidCable::Message.prunable` —
    solid_cable 4.0.2 đổi tên thành `trimmable`. Sai tên thì job lỗi mỗi giờ và bảng
    `solid_cable_messages` phình mãi không dọn.
14. **Ảnh sản phẩm đi qua `/rails/active_storage/...` trên domain backend.** Nếu tách
    domain thì nginx phải route đúng, không thì storefront mất hết ảnh.
