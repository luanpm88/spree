# Deploy

Toàn bộ quá trình khảo sát server, thiết kế deploy, và các bước thực thi.

- Spree là gì → [DESIGN.md](DESIGN.md)
- Chạy local → [LOCAL.md](LOCAL.md)

**Trạng thái: CHƯA deploy.** Đã chuẩn bị xong toàn bộ config, đang chờ chốt hạ tầng
(xem [§2](#2-vấn-đề-ram--cần-quyết-định)).

---

## 1. Khảo sát server (`54.169.34.13`)

Đo trực tiếp qua SSH, ngày 2026-07-29.

### Thông số máy

| | |
|---|---|
| OS | Ubuntu 24.04.4 LTS |
| Kernel | 6.17.0-1019-**aws** → EC2, region ap-southeast-1 (Singapore) |
| Kiến trúc | **x86_64** → build image `linux/amd64` |
| RAM | **1907 MB tổng · 1181 MB đang dùng · ~725 MB còn dùng được** |
| Swap | 4 GB (`/swapfile`), đã dùng ~650 MB |
| Đĩa | 58 GB, dùng 43 GB → **còn 15 GB** |
| sudo | passwordless ✅ |
| Docker | **CHƯA CÓ** ❌ |

### Máy này đang chạy gì

**Đây không phải máy trống — đây là server production đang chạy thật.**

```
mysqld                    20.8% RAM   ← MySQL, tiến trình ngốn nhất
php-fpm: shopcuaban_vn     6.0% + 4.6%
php-fpm: sattanhung_com    5.1% + 4.4%
php-fpm: Guucoffee_com     4.8%
php-fpm: luathuynhgia_com  4.3%
nginx 1.24.0 (3 worker)   → đang giữ cổng 80 và 443
```

nginx đang serve **~28 vhost**, trong đó có site khách hàng thật:

```
shopcuaban.vn        sattanhung.com       luathuynhgia.com    Guucoffee.com
auriuscrm.com        nitrasa.vn           hoanglongtnt.com    ketoantrican.com
khohanglaptop.com    khomaynenkhi.com     bialo.vn            cbenergy.vn
seedcareervn.com     guucafe.com          cafedanhphat.vn     voducfoods.b-teka.com
acellemail.b-teka.com  acm.b-teka.com     nike.b-teka.com     logitech.b-teka.com
autotaybac.b-teka.com  dieuan.b-teka.com  orgafood.b-teka.com  … và vhost khác
```

Stack là **LEMP (nginx + MySQL + PHP-FPM)**, mỗi site một pool PHP-FPM và một user
riêng. Spree là Rails + PostgreSQL → **hoàn toàn tách biệt**, không đụng gì tới MySQL
hay PHP. Nhưng nó **dùng chung RAM**.

### DNS

```
spree.b-teka.com  →  54.169.34.13     ✅ đúng, đã trỏ sẵn
b-teka.com        →  52.220.55.112    (máy khác, không liên quan)
```

### TLS

`certbot` đã có sẵn ở `/usr/bin/certbot`, các vhost hiện tại đều dùng TLS do certbot
quản lý. → Spree đi theo đúng convention đó, **không tự viết block SSL**.

Convention vhost của máy này (đọc từ `acm.b-teka.com`):

- file ở `/etc/nginx/sites-available/<domain>`, symlink sang `sites-enabled/`
- log: `/var/log/nginx/<domain_dùng_gạch_dưới>.access.log`
- block `listen 443 ssl` + redirect 80→443 do certbot tự thêm

---

## 2. Vấn đề RAM — cần quyết định

**Đây là rào cản duy nhất còn lại.**

`render.yaml` do chính Spree phát hành ghi rõ:

> *"a Spree process needs ~1GB RAM, so this doesn't fit free/starter instances"*

Đối chiếu:

```
Spree (Puma 1 worker)   ~  700–1000 MB
PostgreSQL 18           ~  150–250 MB
                        ─────────────
cần                     ~  850–1250 MB
server còn              ~      725 MB      ← thiếu
```

Nghĩa là **thiếu ~150–500 MB**. Máy sẽ vẫn chạy được nhờ 4 GB swap, nhưng:

- swap trên EBS → I/O chậm, latency tăng cho **tất cả** site trên máy
- MySQL bị đẩy ra swap → 28 site PHP kia chậm theo
- lúc cao điểm (import sản phẩm, resize ảnh) dễ bị **OOM killer**, và nó thường
  giết `mysqld` vì đó là tiến trình to nhất → **sập toàn bộ site khách hàng**

Nói thẳng: **deploy Spree lên máy này có rủi ro làm chậm/sập 28 site đang chạy thật.**
Về mặt kỹ thuật thì làm được, nhưng đây là quyết định kinh doanh, không phải kỹ thuật —
nên mình để bạn chốt.

### Các lựa chọn

| | Cách | RAM | Chi phí | Rủi ro site đang chạy |
|---|---|---|---|---|
| **A** | **VPS riêng** cho Spree, 2 GB, trỏ `spree.b-teka.com` sang | đủ | ~5–12 USD/tháng | **không** ⭐ khuyến nghị |
| **B** | Nâng RAM EC2 hiện tại `t3.small`→`t3.medium` (2→4 GB) | đủ | ~+15 USD/tháng, reboot 1 lần | không, sau khi nâng |
| **C** | Deploy luôn lên máy hiện tại, giới hạn RAM + tăng swap | thiếu | 0 | **có** |
| **D** | Chỉ demo, dùng PaaS (Render/Railway free) — repo có sẵn `render.yaml` | đủ | 0 | không |

**Khuyến nghị: A** — VPS riêng 2 GB. Cách ly hoàn toàn, deploy thoải mái, không phải lo
làm ảnh hưởng site khách. Nếu chỉ cần demo cho nhanh thì **D**.

Nếu bạn chọn **C**, mình sẽ làm với các biện pháp giảm thiểu đã cấu hình sẵn:
`WEB_CONCURRENCY=1`, `JOB_THREADS=2`, giới hạn memory container (1200M cho web,
512M cho postgres), Postgres tune nhỏ (`shared_buffers=128MB`), và tăng swap lên 6 GB.
Vẫn **không loại bỏ được** rủi ro OOM, chỉ giảm.

---

## 3. Thiết kế deploy

### Nguyên tắc: server không build

```
   bạn push code
        │
        ▼
   GitHub  ──► Actions: bundle install + assets:precompile + docker build
        │              (runner của GitHub, RAM thoải mái, miễn phí)
        │
        ▼
   ghcr.io/luanpm88/spree:latest        ← image amd64 đã build xong
        │
        ▼  server chỉ `docker compose pull`
   ┌────────────────────────────────────────────────┐
   │  Server 54.169.34.13                           │
   │                                                │
   │  nginx :80/:443  (đã có, dùng chung 28 site)   │
   │     │  spree.b-teka.com                        │
   │     ▼                                          │
   │  127.0.0.1:3010 ──► [web] Puma + Solid Queue   │
   │                        │                       │
   │                        ▼                       │
   │                     [postgres] volume          │
   └────────────────────────────────────────────────┘
```

**Vì sao build ở Actions:** `bundle install` + `assets:precompile` cần ~2 GB RAM. Build
trên server 725 MB sẽ OOM — và trên máy dùng chung thì nó kéo cả site khác chết theo.

**Vì sao bind `127.0.0.1`:** container chỉ mở trên loopback, không ra internet. nginx là
lối vào duy nhất. Nếu bind `0.0.0.0`, Docker chèn rule NAT **trước** ufw → app lộ ra
internet dù firewall đang bật.

### Các file liên quan

| File | Việc |
|---|---|
| [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | build + push image lên GHCR khi push `main` |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | chạy image trên server, có giới hạn RAM |
| [`.env.production.example`](../.env.production.example) | mẫu biến môi trường |
| [`deploy/nginx/spree.b-teka.com.conf`](../deploy/nginx/spree.b-teka.com.conf) | vhost reverse proxy |
| [`script/deploy.sh`](../script/deploy.sh) | pull → backup DB → up → chờ health |

### Khác biệt so với local

| | Local | Production |
|---|---|---|
| Image | build tại máy, `target: dev` | pull từ GHCR, final stage |
| Source code | bind-mount, sửa là thấy | nằm trong image |
| Email | Mailpit bắt hết | SMTP thật |
| `/dashboard` | 404 (không bake) | ✅ có |
| TLS | không | nginx + certbot |
| Migration | `make db-prepare` tay | tự chạy từ entrypoint khi boot |
| Puma workers | 1, 10 job thread | 1, 2 job thread |

---

## 4. Các bước deploy (chạy sau khi chốt §2)

> Chưa chạy bước nào. Ghi ra để review trước.

### 4.1 Cài Docker trên server

```bash
ssh ubuntu@54.169.34.13
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit && ssh ubuntu@54.169.34.13     # login lại để nhận group
docker run --rm hello-world
```

> Trên máy dùng chung: `get.docker.com` cài `containerd` và **có thể chèn rule iptables**.
> Nó không sửa gì của nginx/MySQL/PHP-FPM, nhưng vẫn nên làm lúc ít traffic.

Nếu chọn phương án C, tăng swap trước:

```bash
sudo swapoff /swapfile
sudo fallocate -l 6G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
sudo sysctl -w vm.swappiness=10       # ưu tiên giữ RAM cho tiến trình đang chạy
```

### 4.2 Lấy code + cấu hình

```bash
cd ~ && git clone git@github.com:luanpm88/spree.git && cd spree
cp .env.production.example .env

# sinh secret
openssl rand -hex 64      # → SECRET_KEY_BASE
openssl rand -base64 24   # → MISSION_CONTROL_PASSWORD
nano .env                 # điền cả SMTP nữa, xem §6
```

> Server cần quyền đọc repo. Repo private → thêm deploy key:
> `ssh-keygen -t ed25519 -C spree-deploy -f ~/.ssh/id_ed25519` rồi dán public key vào
> GitHub → repo → Settings → Deploy keys (read-only là đủ).

### 4.3 Đăng nhập GHCR

Image trong GHCR mặc định private → server phải login bằng Personal Access Token có
scope `read:packages`:

```bash
echo <PAT> | docker login ghcr.io -u luanpm88 --password-stdin
```

> Hoặc vào GitHub → Packages → spree → Package settings → đổi visibility sang
> **public**, khi đó không cần login. Image không chứa secret (secret nằm ở `.env`
> runtime), nhưng có chứa toàn bộ source code — cân nhắc.

### 4.4 Chạy

```bash
chmod +x script/deploy.sh
./script/deploy.sh
```

Lần đầu, tạo admin + dữ liệu:

```bash
DC="docker compose -f docker-compose.prod.yml"
$DC exec -T -e EMAIL=admin@b-teka.com -e PASSWORD='<mật khẩu mạnh>' \
   web bin/rails spree:cli:create_admin
$DC exec web bin/rails spree:cli:ensure_api_key

# Demo B2B/B2C. BỎ QUA nếu đây là store thật — nó tạo sản phẩm giả.
$DC exec web bin/rails spree:load_sample_data
```

### 4.5 nginx + TLS

```bash
sudo cp deploy/nginx/spree.b-teka.com.conf /etc/nginx/sites-available/spree.b-teka.com
sudo ln -s /etc/nginx/sites-available/spree.b-teka.com /etc/nginx/sites-enabled/
sudo nginx -t                       # BẮT BUỘC — cấu hình sai là 28 site kia sập
sudo systemctl reload nginx
sudo certbot --nginx -d spree.b-teka.com
```

`nginx -t` fail thì **xoá symlink rồi reload lại**, đừng cố sửa khi đang lỗi.

### 4.6 Kiểm tra

```bash
curl -I https://spree.b-teka.com/up          # 200
curl -I https://spree.b-teka.com/admin       # 302 → sign_in
free -m                                      # còn RAM không?
docker stats --no-stream                     # container ăn bao nhiêu
```

Và test email — xem §6. **Chưa test email thì coi như chưa xong.**

---

## 5. Deploy lần sau

```bash
git push origin main          # Actions build image (~5-10 phút)
ssh ubuntu@54.169.34.13 'cd ~/spree && ./script/deploy.sh'
```

`script/deploy.sh` tự: pull code → **dump DB ra `backups/`** → pull image → up →
chờ `/up` trả 200 → dọn image cũ. Nếu health fail nó in 60 dòng log cuối và exit khác 0.

Sửa docs thì Actions **không build** (đã ignore `docs/**`).

### Rollback

```bash
# tìm tag commit trước
docker images | grep spree
# ghim vào .env rồi chạy lại
echo 'SPREE_IMAGE=ghcr.io/luanpm88/spree:sha-<commit>' >> .env
./script/deploy.sh
```

> Rollback image **không** hoàn nguyên migration. Nếu bản mới có migration phá vỡ
> tương thích, phải restore từ `backups/pre-deploy-*.sql.gz`.

---

## 6. Email — phải cấu hình, không thì store không dùng được

**Nếu `SMTP_HOST` rỗng, Spree chỉ ghi mail vào log. Khách không nhận được gì:** không có
mail xác nhận đơn, không reset được mật khẩu, không mời được admin.

Cần 5 giá trị:

```bash
SMTP_HOST=            # vd smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_ADDRESS=store@b-teka.com
```

Chọn nhà cung cấp:

| | Ghi chú |
|---|---|
| **Acelle trên chính máy này** (`acellemail.b-teka.com`) | bạn đang chạy sẵn — có SMTP thì dùng luôn, không phát sinh chi phí |
| SendGrid / Mailgun / Brevo | free tier ~100 mail/ngày, deliverability tốt |
| Amazon SES | rẻ nhất khi volume lớn, cùng region ap-southeast-1, phải xin ra khỏi sandbox |
| Gmail SMTP | **đừng dùng cho production** — giới hạn thấp, dễ bị chặn |

> **Cổng 25 ra ngoài bị AWS chặn mặc định.** Luôn dùng cổng **587** (hoặc 465).

Kiểm tra sau khi set:

```bash
docker compose -f docker-compose.prod.yml exec web \
  bin/rails runner script/smoke_mail.rb ban@email.com
```

Và để mail không vào spam, thêm DNS cho `b-teka.com`: **SPF**, **DKIM** (nhà cung cấp
cấp), **DMARC**. Thiếu SPF/DKIM là gần như chắc chắn vào spam.

---

## 7. Checklist trước khi coi là xong

- [ ] Chốt hạ tầng ([§2](#2-vấn-đề-ram--cần-quyết-định))
- [ ] Docker chạy trên server
- [ ] `.env` đủ: `SECRET_KEY_BASE`, `RAILS_HOST`, `MISSION_CONTROL_PASSWORD`
- [ ] Server login được GHCR (hoặc image đã public)
- [ ] `./script/deploy.sh` chạy xanh
- [ ] vhost nginx cài, `nginx -t` pass, certbot ra cert
- [ ] `https://spree.b-teka.com/up` → 200
- [ ] Đăng nhập `/admin` được
- [ ] **SMTP set và `script/smoke_mail.rb` gửi tới hộp thư thật**
- [ ] SPF + DKIM + DMARC cho domain gửi mail
- [ ] `/jobs` đòi mật khẩu (không để mặc định)
- [ ] `free -m` còn RAM sau khi chạy 30 phút
- [ ] Backup DB có định kỳ (§8) — không chỉ backup lúc deploy
- [ ] 28 site kia vẫn bình thường 🙏

---

## 8. Vận hành

### Lệnh hay dùng

```bash
DC="docker compose -f docker-compose.prod.yml"
$DC ps                    # trạng thái
$DC logs -f --tail=100 web
$DC exec web bin/rails console
$DC exec postgres psql -U postgres spree_production
$DC restart web
docker stats --no-stream  # RAM/CPU thật
```

### Backup định kỳ

`script/deploy.sh` chỉ backup **lúc deploy**. Cần cron riêng:

```bash
# crontab -e — 3h sáng mỗi ngày, giữ 14 bản
0 3 * * * cd /home/ubuntu/spree && \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres spree_production | gzip > backups/daily-$(date +\%F).sql.gz && \
  find backups -name 'daily-*.sql.gz' -mtime +14 -delete
```

Đĩa chỉ còn 15 GB → **nên đẩy backup ra ngoài** (S3/R2), đừng để nằm mãi trên máy.

Nhớ backup cả **volume `storage_data`** (ảnh sản phẩm) — `pg_dump` không có ảnh:

```bash
docker run --rm -v spree_storage_data:/data -v $PWD/backups:/b alpine \
  tar czf /b/storage-$(date +%F).tar.gz -C /data .
```

### Restore

```bash
gunzip -c backups/pre-deploy-XXX.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres spree_production
```

---

## 9. Ghi chú tích luỹ

Cập nhật khi phát hiện thêm.

1. **Server là máy production dùng chung, không phải máy trống.** Mọi thao tác phải cân
   nhắc 28 site đang chạy. Luôn `nginx -t` trước khi reload.
2. **Không build trên server.** Build cần ~2 GB.
3. Server là **x86_64** → image `linux/amd64`. Máy dev là Apple Silicon (arm64) → **image
   local và image prod khác kiến trúc**, không dùng lẫn được.
4. `RAILS_ASSUME_SSL=true` + `RAILS_FORCE_SSL=false` khi có nginx đứng trước. Đặt
   `FORCE_SSL=true` sẽ **redirect vô hạn** vì nginx đã redirect rồi.
5. Bind `127.0.0.1`, không bao giờ `0.0.0.0` — Docker chèn NAT trước ufw.
6. `RAILS_HOST` sai → link trong email và URL ảnh trong API sai. Không có lỗi báo, chỉ
   là link hỏng.
7. Migration chạy từ entrypoint image (`bin/docker-entrypoint` gọi `db:prepare` khi
   command là `rails server`) → **không cần** bước migrate riêng, nhưng cũng nghĩa là
   **backup phải làm TRƯỚC khi container mới lên**. `script/deploy.sh` làm đúng thứ tự đó.
8. Cổng 25 bị AWS chặn → SMTP phải 587/465.
9. Không cần Redis: Solid Queue/Cache/Cable đều nằm trong Postgres.
