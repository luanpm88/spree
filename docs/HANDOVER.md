# Bàn giao — Spree Commerce (b-teka)

**Ngày bàn giao:** 30/07/2026
**Trạng thái:** đang chạy trên production, dùng để demo/UAT.

Tài liệu này dành cho **người tiếp nhận đã biết Spree**. Nội dung: đăng nhập ở đâu,
đang có gì, chưa có gì, và bước tiếp theo.

- Chưa biết Spree → đọc [USER_GUIDE.md](USER_GUIDE.md) (có bản PDF)
- Cần hiểu kiến trúc / data model → [DESIGN.md](DESIGN.md)
- Chạy trên máy cá nhân → [LOCAL.md](LOCAL.md)
- Chi tiết vận hành hạ tầng → [DEPLOY.md](DEPLOY.md)

---

## 1. Bắt đầu từ đâu

| # | Việc | Link |
|---|---|---|
| 1 | Đăng nhập trang quản trị | **https://spree.b-teka.com/admin** |
| 2 | Xem cửa hàng phía khách | **https://shop.b-teka.com** |
| 3 | Đọc phần B2B để hiểu cấu hình bán sỉ | [USER_GUIDE.md §5](USER_GUIDE.md) |

Tài khoản quản trị chính:

```
https://spree.b-teka.com/admin
admin@b-teka.com  /  C6iKd7JsGZTjTbJv
```

> **Đổi mật khẩu ngay sau khi nhận bàn giao.** Đây là mật khẩu sinh tự động lúc bàn
> giao, đã đi qua kênh chat.

---

## 2. Đường dẫn

| Chức năng | URL | Ghi chú |
|---|---|---|
| **Cửa hàng (khách mua)** | https://shop.b-teka.com | Next.js storefront |
| **Quản trị** | https://spree.b-teka.com/admin | Rails admin |
| Dashboard mới (React) | https://spree.b-teka.com/dashboard | bản admin thế hệ mới |
| Store API | https://spree.b-teka.com/api/v3/store/ | cho storefront |
| Admin API | https://spree.b-teka.com/api/v3/admin/ | cho tích hợp |
| Hàng đợi tác vụ | https://spree.b-teka.com/jobs | HTTP Basic riêng |
| Health check | https://spree.b-teka.com/up | trả 200 nếu app sống |

Cả hai domain đều đã có HTTPS (Let's Encrypt, tự động gia hạn).

---

## 3. Tài khoản

Tất cả tài khoản nhân viên dùng chung mật khẩu bàn giao: **`C6iKd7JsGZTjTbJv`**

### 3.1 Nhân viên — đăng nhập `/admin`

| Email | Vai trò | Phạm vi |
|---|---|---|
| `admin@b-teka.com` | Quản trị | Toàn quyền, kể cả phân quyền + cấu hình |
| `manager@b-teka.com` | Quản lý | Đơn, sản phẩm, tồn kho, khuyến mãi, bảng giá, xem khách |
| `catalog@b-teka.com` | NV sản phẩm | Chỉ sản phẩm, tồn kho, bảng giá |
| `fulfillment@b-teka.com` | NV xử lý đơn | Đơn, khách, tồn kho, xem sản phẩm |
| `sales_b2b@b-teka.com` | NV bán sỉ | Đơn, sản phẩm, tồn kho, **quản lý khách & nhóm khách** |
| `support@b-teka.com` | CSKH | **Chỉ xem** |

Phân quyền đã được kiểm chứng tự động (`node script/audit_roles.mjs` — 6/6 đúng).
Ví dụ: `catalog` không vào được Đơn hàng/Khách hàng; chỉ `admin` vào được Cấu hình.

> **Hai điều về phân quyền Spree cần biết:**
> 1. Tạo Role trong `/admin` mà **không gán permission set** thì người đó đăng nhập
>    được nhưng không thấy gì. Permission set khai báo trong
>    `config/initializers/spree.rb`, không khai báo qua giao diện.
> 2. Màn hình **Price Lists gated bởi `ProductDisplay`**, không phải
>    `ProductManagement`. Nên vai trò chỉ-đọc (`support`) **vẫn xem được giá sỉ**.
>    Đây là hành vi của Spree. Muốn chặn thì bỏ `ProductDisplay` khỏi role `support`.

### 3.2 Khách hàng — đăng nhập ở storefront

| Email | Loại | Mật khẩu |
|---|---|---|
| `wholesale@example.com` | **Khách B2B**, thuộc nhóm `Wholesale` | `C6iKd7JsGZTjTbJv` |
| `retail@b-teka.com` | Khách lẻ | `C6iKd7JsGZTjTbJv` |

### 3.3 Khác

| | |
|---|---|
| `/jobs` | HTTP Basic — user `jobs`, mật khẩu trong `.env` trên server |
| API key (kênh online / B2C) | `pk_ypr3YTTdE4YqhhPWygYo992o` |
| API key (kênh wholesale / B2B) | `pk_YPG1LGBuNM46FfqoPq1L5qCF` |

API key truyền qua header **`X-Spree-Api-Key`** (không phải `Authorization: Bearer`).

---

## 4. Nền tảng & phiên bản

| Thành phần | Phiên bản |
|---|---|
| Spree Commerce | **5.6.1 Community Edition** |
| Rails | 8.1.3 |
| Ruby | 4.0.1 |
| PostgreSQL | 18.4 |
| Storefront | spree/storefront — Next.js 16, React 19, Tailwind 4 (MIT) |
| Node (storefront) | 22 |
| OS | Ubuntu 24.04 LTS |
| Container runtime | Docker + Docker Compose |
| Web server | nginx (reverse proxy, TLS qua Let's Encrypt) |

### Kiến trúc

```
   Khách  ──►  shop.b-teka.com    ──►  Storefront (Next.js)  ──┐
                                                                │ Store API
   NV     ──►  spree.b-teka.com   ──►  Spree (Rails + Puma)  ◄──┘
                                            │
                                            └──►  PostgreSQL
```

- **Không dùng Redis.** Hàng đợi (Solid Queue), cache (Solid Cache) và websocket
  (Solid Cable) đều nằm trong PostgreSQL. Job chạy trong cùng process Puma.
- **Không có worker riêng** — bớt một thành phần phải vận hành.
- Tất cả chạy trong Docker container; nginx trên host làm reverse proxy và TLS.
- Ảnh sản phẩm lưu bằng Active Storage trên disk (volume Docker).

### Quy trình phát hành

```
git push origin main
   └─► GitHub Actions build image (linux/amd64) ─► GitHub Container Registry
          └─► trên server:  ./script/deploy.sh   (pull + restart + health check)
```

Server **không build** — chỉ tải image đã build sẵn. `script/deploy.sh` tự backup
database trước khi container mới khởi động (migration chạy từ entrypoint của image).

Mã nguồn: **github.com/luanpm88/spree**

---

## 5. Đang có gì

| | Trạng thái |
|---|---|
| Trang quản trị đầy đủ | ✅ |
| Storefront cho khách (Next.js) | ✅ |
| Store API + Admin API | ✅ |
| 6 vai trò nhân viên, đã audit | ✅ |
| **B2B**: kênh riêng bắt đăng nhập | ✅ |
| **B2B**: nhóm khách hàng | ✅ |
| **B2B**: bảng giá theo nhóm + theo số lượng | ✅ |
| Multi-channel (online / wholesale / pos) | ✅ |
| Multi-market (7 vùng) | ✅ |
| HTTPS cả 2 domain, tự gia hạn | ✅ |
| CI/CD build image tự động | ✅ |
| Backup database mỗi lần deploy | ✅ |

### Dữ liệu hiện tại — **là dữ liệu mẫu**

36 sản phẩm / 121 biến thể / 22 khách / 2 đơn / 24 danh mục / 12 phương thức vận
chuyển. Đây là **demo data của Spree**, không phải hàng thật. Trước khi chạy thật
phải xoá và nhập catalog thật.

### Cấu hình B2B đang có

| Thành phần | Giá trị |
|---|---|
| Kênh B2B | `wholesale` — *Storefront access: Login required*, *Guest checkout: Not allowed* |
| Nhóm khách | `Wholesale` |
| Bảng giá | `Wholesale` — Active, 255 giá, **match ALL** hai điều kiện: |
| → điều kiện 1 | Volume Rule — mua từ **10** cái |
| → điều kiện 2 | Customer Group Rule — thuộc nhóm **Wholesale** |

Nghĩa là khách phải **vừa** thuộc nhóm Wholesale **vừa** mua ≥10 cái mới được giá sỉ.

---

## 6. Chưa có gì — cần làm trước khi chạy thật

Xếp theo mức độ chặn.

| # | Việc | Mức | Ghi chú |
|---|---|---|---|
| 1 | **Cấu hình SMTP** | 🔴 **chặn** | `SMTP_HOST` đang rỗng → Spree **chỉ ghi log**, khách **không nhận được email nào**: không có xác nhận đơn, không reset được mật khẩu. Cần SMTP + SPF/DKIM/DMARC. |
| 2 | **Cổng thanh toán VN** | 🔴 **chặn** | Đang chỉ có Stripe / PayPal / Adyen. VNPay / MoMo / chuyển khoản **chưa có gem**, phải tự viết `PaymentMethod`. |
| 3 | **Đổi tiền tệ sang VND** | 🔴 **chặn** | Store đang để **USD**. Đổi sang VND phải nhập lại toàn bộ giá. |
| 4 | Xoá dữ liệu mẫu, nhập catalog thật | 🔴 | |
| 5 | Đổi toàn bộ mật khẩu bàn giao | 🔴 | |
| 6 | **Nâng RAM server** | 🟠 | Xem mục 7. |
| 7 | Luồng duyệt đơn B2B | 🟠 | Bảng `OrderApproval` đã có sẵn nhưng **luồng tạo/duyệt phải tự lập trình**. |
| 8 | Mời nhiều người dùng vào 1 tài khoản công ty | 🟠 | Bảng `Invitation` đã có, cần dựng luồng. |
| 9 | Công nợ / thanh toán sau (NET 30) | 🟡 | Chưa có, phải tự làm. |
| 10 | Báo giá (quotation) | 🟡 | Chưa có, phải tự làm. |
| 11 | Backup định kỳ ra ngoài server | 🟡 | Hiện chỉ backup lúc deploy, lưu ngay trên máy. |
| 12 | Đặt `JWT_SECRET_KEY` riêng | 🟡 | Đang fallback về `secret_key_base`. |
| 13 | Giao diện storefront còn là bản mẫu Spree | 🟡 | Cần thiết kế lại theo thương hiệu. |
| 14 | Tiếng Việt | 🟡 | `spree_i18n` đã cài, chưa kiểm tra độ phủ bản dịch. |

---

## 7. Cảnh báo hạ tầng — cần xử lý

**Máy chủ hiện tại đang chia sẻ với khoảng 28 website khác** (MySQL + PHP-FPM) và
**tổng RAM chỉ 1.9 GB**.

Tài liệu chính thức của Spree ghi một tiến trình Spree cần **~1 GB RAM**. Thực đo
trên máy này: Spree ~480 MB lúc bình thường, **~890 MB khi xử lý ảnh**, cộng thêm
storefront Next.js và PostgreSQL.

Trong quá trình triển khai, kernel đã **OOM-kill một tiến trình 128 KB** khi làm thao
tác bảo trì swap — cho thấy máy thực sự đang sát ngưỡng.

Biện pháp đã áp dụng:

- swap nâng lên 6 GB, `vm.swappiness=10`
- giới hạn RAM từng container (Spree 1200 MB, PostgreSQL 512 MB, storefront 420 MB)
- PostgreSQL tinh chỉnh nhỏ lại (`shared_buffers=128MB`)
- **`mysqld` được đặt `oom_score_adj=-800`** → nếu hết RAM, kernel sẽ giết container
  Spree/storefront **trước**, không giết MySQL của 28 site kia

**Khuyến nghị: tách Spree sang máy riêng ≥2 GB RAM, hoặc nâng RAM máy hiện tại lên
4 GB.** Cấu hình hiện tại chạy được để demo/UAT, nhưng không nên chạy thật lâu dài.

---

## 8. Vận hành hằng ngày

Toàn bộ lệnh chạy trong thư mục mã nguồn trên server.

```bash
# phát hành phiên bản mới
git push origin main          # CI build image
./script/deploy.sh            # trên server: pull + restart + health check

# xem trạng thái / log
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100 web

# Rails console / database
docker compose -f docker-compose.prod.yml exec web bin/rails console
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres spree_production

# tạo lại tài khoản demo (đổi mật khẩu)
docker compose -f docker-compose.prod.yml exec web bin/rails demo:seed_users PASSWORD='...'

# kiểm tra email sau khi cấu hình SMTP
docker compose -f docker-compose.prod.yml exec web bin/rails runner script/smoke_mail.rb ban@email.com
```

Rollback: ghim `SPREE_IMAGE=ghcr.io/luanpm88/spree:sha-<commit>` trong `.env` rồi chạy
lại `./script/deploy.sh`. Lưu ý rollback image **không** hoàn nguyên migration — nếu
cần thì restore từ `backups/pre-deploy-*.sql.gz`.

---

## 9. Lưu ý kỹ thuật dễ vấp

1. **Storefront nung API URL vào lúc build.** Đổi backend mà storefront trỏ tới là
   phải **build lại image**, không phải đổi biến môi trường.
2. **Store API dùng header `X-Spree-Api-Key`.** Dùng `Authorization: Bearer` sẽ nhận
   401.
3. **API key gắn theo kênh.** Key của kênh `wholesale` trả 401 khi chưa đăng nhập —
   đó là *cổng B2B*, không phải lỗi.
4. **`RAILS_ASSUME_SSL=true` + `RAILS_FORCE_SSL=false`.** Đặt `FORCE_SSL=true` sẽ gây
   **redirect vô hạn** vì nginx đã redirect rồi.
5. **Migration chạy từ entrypoint của image** khi container khởi động → backup phải
   làm *trước*, và `script/deploy.sh` đã làm đúng thứ tự đó.
6. **Container chỉ bind `127.0.0.1`.** Không đổi thành `0.0.0.0` — Docker chèn rule
   NAT *trước* firewall, app sẽ lộ thẳng ra internet.
7. **Không sửa code trong gem.** Thứ tự ưu tiên khi cần đổi hành vi: Events &
   Subscribers → swap service qua `Spree.dependencies` → extension → decorator (cuối
   cùng). Cần thêm field thì thử **Metafield** trước khi tạo migration.
8. **AWS chặn cổng 25** → SMTP phải dùng 587 hoặc 465.
