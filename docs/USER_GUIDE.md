# Spree — Hướng dẫn toàn tập

**Dự án:** cửa hàng thương mại điện tử B2B + B2C trên Spree Commerce
**Phiên bản:** Spree 5.6.1 (Community Edition) · Rails 8.1.3 · Ruby 4.0.1 · PostgreSQL 18
**Cập nhật:** 30/07/2026

---

## Đọc file này thế nào

Tài liệu đi từ **đơn giản → chi tiết**. Không cần đọc hết một lượt.

| Bạn là | Đọc phần |
|---|---|
| Mới nghe tới Spree, muốn hiểu nó là gì | **1 – 2** |
| Muốn chạy thử trên máy ngay | **3** |
| Muốn biết trong admin có gì | **4** |
| Cần hiểu/dựng bán sỉ B2B | **5** |
| Sắp bắt tay làm việc cụ thể | **6** (theo vai trò của bạn) |
| Lập trình viên | **7 – 8** |

Mọi ảnh trong tài liệu này là **ảnh chụp thật** từ hệ thống đã dựng, không phải ảnh
minh hoạ từ website Spree.

Tài liệu kỹ thuật đi kèm:

- [DESIGN.md](DESIGN.md) — kiến trúc, data model, điểm mở rộng
- [LOCAL.md](LOCAL.md) — cài đặt local và các lỗi thường gặp
- [DEPLOY.md](DEPLOY.md) — khảo sát server và cách deploy

---

# Phần 1 — Spree là gì

## 1.1 Nói ngắn gọn

Spree là **bộ khung để tự xây sàn thương mại điện tử**, viết bằng Ruby on Rails, mã
nguồn mở.

Nó cho bạn sẵn: sản phẩm, biến thể, giỏ hàng, thanh toán, vận chuyển, thuế, khuyến mãi,
tồn kho, khách hàng, đơn hàng, trả hàng, và một trang quản trị hoàn chỉnh.

## 1.2 Spree khác Shopify / WooCommerce ở đâu

|  | Shopify | WooCommerce | **Spree** |
|---|---|---|---|
| Kiểu | SaaS, thuê tháng | plugin WordPress | **framework, tự host** |
| Sở hữu dữ liệu | Shopify giữ | bạn giữ | **bạn giữ** |
| Chi phí | phí tháng + % giao dịch | hosting | **chỉ hạ tầng** |
| Giới hạn tuỳ biến | luật của Shopify | trong khuôn WordPress | **gần như không** |
| B2B | phải lên Plus (đắt) | cần plugin trả phí | **có sẵn, miễn phí** |
| Cần lập trình viên | không | ít | **có** |

Chọn Spree khi: cần nghiệp vụ đặc thù, cần tích hợp sâu hệ thống nội bộ (ERP, kế toán),
cần B2B nghiêm túc, hoặc không muốn bị khoá vào một nhà cung cấp.

Không chọn Spree khi: chỉ cần bán vài chục sản phẩm đơn giản và không có lập trình viên.

## 1.3 Điều quan trọng nhất phải hiểu: Spree "headless"

**Spree 5 không có sẵn trang bán hàng cho khách.**

Nghe lạ nhưng đây là chủ ý. Spree cung cấp **bộ não** (dữ liệu + nghiệp vụ + API) và
**trang quản trị**. Còn **bộ mặt** — trang khách vào xem và mua — là một ứng dụng riêng
mà bạn tự làm, gọi dữ liệu qua API.

```
   ┌────────────────────────┐          ┌─────────────────────────────┐
   │  Trang khách hàng      │  API     │   Spree  (dự án này)        │
   │  (CHƯA LÀM)            │ ───────► │   • dữ liệu, nghiệp vụ      │
   │  Next.js / React / …   │          │   • trang quản trị /admin   │
   └────────────────────────┘          └─────────────────────────────┘
```

Trang khách hàng của dự án này dùng **[spree/storefront](https://github.com/spree/storefront)**
— storefront chính chủ của Spree, mã nguồn mở (MIT), viết bằng Next.js 16 + React 19 +
Tailwind 4. Đã dựng sẵn:

| | |
|---|---|
| Local | http://localhost:3001 |
| Production | **https://shop.b-teka.com** |

![Cửa hàng cho khách — chạy thật trên production](screenshots/25-storefront-prod.png)

Vào thẳng `spree.b-teka.com/` sẽ nhảy sang `/admin` — đúng như thiết kế, vì đó là
domain của backend/quản trị, còn cửa hàng nằm ở domain riêng.

Lợi ích của cách này: một backend phục vụ được **nhiều mặt tiền cùng lúc** — web B2C,
web B2B, app mobile, máy POS tại quầy — mà không phải viết lại nghiệp vụ.

---

# Phần 2 — Khái niệm cơ bản

Chỉ cần nắm 8 khái niệm là hiểu được 90% Spree.

## 2.1 Product và Variant — quan trọng nhất

```
Product  "Áo thun Cotton"          ← thứ khách TÌM THẤY và xem
   │
   ├── Variant  "Áo thun / M / Trắng"   ← thứ khách THỰC SỰ MUA
   ├── Variant  "Áo thun / L / Trắng"
   └── Variant  "Áo thun / L / Đen"
```

> **Nhớ:** giá và số lượng tồn kho gắn vào **Variant**, không phải Product.
> Product chỉ là cái vỏ gom nhóm. Sản phẩm không có size/màu vẫn có 1 variant ẩn.

Vì sao quan trọng: khi bạn thấy "nhập giá ở đâu?" — câu trả lời luôn là ở variant.

## 2.2 Taxonomy và Taxon — danh mục

`Taxon` là một danh mục. `Taxonomy` là gốc của một cây danh mục.

```
Taxonomy "Danh mục"          Taxonomy "Thương hiệu"
  └── Áo                       └── Nike
       ├── Áo thun                  Adidas
       └── Áo khoác
```

Một sản phẩm nằm được ở **nhiều** taxon cùng lúc.

## 2.3 Order — giỏ hàng và đơn hàng là cùng một thứ

Đây là điểm hay gây bất ngờ. Trong Spree, giỏ hàng **chính là** một đơn hàng đang ở
trạng thái `cart`. Nó "trở thành đơn" khi khách đi hết quy trình thanh toán.

```
cart → address → delivery → payment → confirm → complete
 giỏ    địa chỉ   vận chuyển  thanh toán  xác nhận  xong
```

Ngoài ra còn: `canceled` (huỷ), `returned` (đã trả hàng), `resumed` (mở lại).

## 2.4 Store / Channel / Market — ba trục khác nhau

Ba khái niệm này rất dễ lẫn. Chúng **độc lập** với nhau:

|  | Trả lời câu hỏi | Ví dụ trong hệ thống |
|---|---|---|
| **Store** | Đây là *doanh nghiệp* nào? | `Shop` |
| **Channel** | Khách đến bằng *đường* nào? | `Online Store`, `Wholesale`, `Point of Sale` |
| **Market** | Bán cho *vùng* nào? | US, Europe, Asia, Africa, … (7 vùng) |

**Channel là chìa khoá của B2B** — xem Phần 5.

## 2.5 Price List — bảng giá

Một sản phẩm có thể có **nhiều giá khác nhau**, tuỳ ai mua và mua bao nhiêu.
`PriceList` là một bảng giá có điều kiện áp dụng. Đây là nền tảng bán sỉ.

## 2.6 Customer Group — nhóm khách hàng

Gom khách thành nhóm (`Wholesale`, `Đại lý cấp 1`, `VIP`…). Nhóm này nối vào Price List
để ra giá riêng cho từng nhóm.

## 2.7 Adjustment — mọi khoản cộng/trừ

Thuế và giảm giá **không sửa trực tiếp tổng tiền**. Chúng tạo ra các dòng `Adjustment`.

```
Tổng đơn = tiền hàng + các adjustment (thuế +, giảm giá −, phí ship +)
```

Nhờ vậy luôn giải thích được "vì sao ra số tiền này".

## 2.8 Hai loại người dùng

```
User        = khách mua hàng
AdminUser   = nhân viên đăng nhập trang quản trị
```

Hai bảng hoàn toàn riêng. Nhân viên đăng nhập ở `/admin_user/sign_in`; khách đăng nhập
qua storefront/API.

---

# Phần 3 — Bắt đầu trong 5 phút

## 3.1 Cần gì

- **Docker** đang chạy (Docker Desktop, OrbStack, hoặc `colima start --cpu 4 --memory 8`)
- Khoảng 6 GB đĩa trống

Không cần cài Ruby, Rails hay PostgreSQL — tất cả nằm trong Docker.

Kiểm tra máy đã đủ chưa:

```bash
make doctor
```

## 3.2 Chạy

```bash
make setup
```

Một lệnh. Khoảng 10 phút lần đầu (chủ yếu tải và build image). Nó tự làm: build image →
bật container → tạo database → nạp dữ liệu mẫu → tạo tài khoản admin.

## 3.3 Vào hệ thống

| Địa chỉ | Là gì |
|---|---|
| http://spree.local/admin · http://localhost:3000/admin | **Trang quản trị** |
| http://mail.spree.local · http://localhost:8025 | Hộp thư (bắt mọi email) |
| http://spree.local/jobs | Hàng đợi tác vụ nền |

Đăng nhập quản trị:

```
Email:    admin@b-teka.com
Mật khẩu: spree123456
```

![Trang đăng nhập](screenshots/01-login.png)

> `spree.local` cần một dòng trong `/etc/hosts`:
> `echo '127.0.0.1  spree.local mail.spree.local' | sudo tee -a /etc/hosts`
> Không thêm cũng được, dùng `localhost:3000` bình thường.

## 3.4 Lệnh hằng ngày

```bash
make up        # bật
make down      # tắt (không mất dữ liệu)
make logs      # xem log
make console   # Rails console
make mail      # thử gửi email
make help      # xem hết
```

---

# Phần 4 — Tham quan trang quản trị

Đăng nhập xong bạn thấy Dashboard.

![Dashboard](screenshots/02-dashboard.png)

Menu bên trái là toàn bộ hệ thống: **Orders** (đơn), **Returns** (trả hàng),
**Products** (sản phẩm, kèm Price Lists / Stock / Categories / Options), **Customers**
(khách), **Promotions** (khuyến mãi), **Reports** (báo cáo), **Integrations** (tích hợp),
**Settings**, **Users**.

## 4.1 Sản phẩm

![Danh sách sản phẩm](screenshots/03-products.png)

Dữ liệu mẫu có **36 sản phẩm / 121 biến thể**. Mỗi dòng cho thấy trạng thái, tồn kho và
số biến thể.

Mở một sản phẩm:

![Chi tiết sản phẩm](screenshots/04-product-edit.png)

Đây là nơi khai báo tên, mô tả, ảnh, **biến thể**, **giá**, tồn kho, danh mục, SEO.

## 4.2 Danh mục

![Taxonomy](screenshots/05-taxonomies.png)

## 4.3 Đơn hàng

![Danh sách đơn](screenshots/06-orders.png)

Mở một đơn để thấy toàn bộ: khách, sản phẩm, tiền, thanh toán, vận chuyển, lịch sử.

![Chi tiết đơn](screenshots/07-order-detail.png)

## 4.4 Khách hàng

![Khách hàng](screenshots/08-customers.png)

Dữ liệu mẫu có 21 khách, trong đó `wholesale@example.com` là **khách B2B**.

## 4.5 Vận hành khác

| | |
|---|---|
| ![Tồn kho](screenshots/18-stock.png) | **Tồn kho** — theo từng kho, từng biến thể |
| ![Vận chuyển](screenshots/16-shipping-methods.png) | **Vận chuyển** — 12 phương thức mẫu |
| ![Thanh toán](screenshots/17-payment-methods.png) | **Thanh toán** — Stripe, PayPal, Adyen đã cài sẵn gem |
| ![Khuyến mãi](screenshots/15-promotions.png) | **Khuyến mãi** — điều kiện + hành động |
| ![Thuế](screenshots/19-tax-rates.png) | **Thuế** — theo vùng và nhóm hàng |

## 4.6 Cấu hình & phân quyền

![Cấu hình cửa hàng](screenshots/20-store-settings.png)

![Vai trò](screenshots/21-roles.png)

## 4.7 Email

Ở máy local, **mọi email đều bị giữ lại**, không có thư nào ra ngoài internet. Xem tại
Mailpit:

![Mailpit](screenshots/23-mailpit.png)

> Lên server thật thì phải cấu hình SMTP, nếu không **khách sẽ không nhận được email
> nào** (kể cả xác nhận đơn và reset mật khẩu). Xem [DEPLOY.md §6](DEPLOY.md).

---

# Phần 5 — B2B: bán sỉ

Đây là phần quan trọng nhất của dự án.

## 5.1 Tin tốt

**Spree Community Edition (miễn phí) làm được B2B.** Không cần mua Enterprise Edition.

Và hệ thống vừa dựng **đã có sẵn một demo B2B hoàn chỉnh** để xem và bắt chước.

## 5.2 B2B khác B2C ở đâu

| | **B2C** — bán lẻ | **B2B** — bán sỉ |
|---|---|---|
| Ai xem được hàng | ai cũng xem | phải đăng nhập |
| Mua không cần tài khoản | được | không |
| Giá | một giá niêm yết | giá riêng theo nhóm KH & số lượng |
| Duyệt đơn | không | có thể cần cấp trên duyệt |
| Một công ty nhiều người mua | không | có |

## 5.3 Spree làm B2B bằng cách nào

Spree **không có "nút bật chế độ B2B"**. B2B được ghép từ 3 mảnh có sẵn:

```
   ①  Channel          → dựng CỔNG: bắt đăng nhập mới xem được hàng
   ②  Customer Group   → biết AI là khách sỉ
   ③  Price List       → cho họ GIÁ RIÊNG
```

### ① Channel — cái cổng

Hệ thống có 3 channel:

![Channels](screenshots/12-channels.png)

So sánh hai channel là thấy ngay cơ chế.

**Channel B2C** — để mặc định, ai cũng vào xem:

![Channel B2C](screenshots/13a-channel-b2c.png)

**Channel B2B** — hai dòng cuối chính là cổng B2B:

![Channel B2B](screenshots/13b-channel-b2b.png)

> - **Storefront access: “Login required — visitors must sign in to browse”**
>   → chưa đăng nhập thì **không xem được hàng, không thấy giá**
> - **Guest checkout: “Not allowed”** → bắt buộc có tài khoản mới mua được

Đã kiểm chứng bằng API thật: gọi danh sách sản phẩm bằng khoá của channel Wholesale mà
chưa đăng nhập thì bị chặn —

```
HTTP 401
{"error":{"code":"authentication_required",
          "message":"Authentication required to access this store."}}
```

Cùng lệnh đó với khoá của channel Online Store thì trả về đủ 36 sản phẩm.

### ② Customer Group — ai là khách sỉ

![Nhóm khách hàng](screenshots/09-customer-groups.png)

Nhóm `Wholesale` hiện có 1 thành viên: `wholesale@example.com`.

### ③ Price List — giá sỉ

![Price Lists](screenshots/10-price-lists.png)

Mở bảng giá `Wholesale`:

![Chi tiết bảng giá](screenshots/11-price-list-detail.png)

Đọc ảnh trên thành lời:

> Bảng giá **Wholesale**, đang **Active**, *“giảm 40% so với giá lẻ cho khách B2B đã
> được duyệt, khi mua từ 10 cái mỗi mặt hàng”*, áp cho **36 sản phẩm**.
>
> **Match all of these rules** — phải thoả **cả hai** điều kiện:
> - **Volume Rule** — Min Quantity **10**, Max **Unlimited**
> - **Customer Group Rule** — Customer Group: **Wholesale**

Tức là: *khách thuộc nhóm Wholesale **VÀ** mua ≥ 10 cái → được giá sỉ.* Mua 9 cái, hoặc
khách lẻ mua 100 cái → vẫn giá lẻ.

Spree có **6 loại điều kiện** để phối giá:

| Điều kiện | Áp giá khi |
|---|---|
| **Customer Group Rule** | khách thuộc nhóm nào → *bậc giá đại lý* |
| **Volume Rule** | mua đủ số lượng → *giá theo số lượng* |
| **Channel Rule** | vào từ channel nào |
| **Market Rule** | khách ở vùng nào |
| **Zone Rule** | khách ở khu vực nào |
| **User Rule** | đúng một khách cụ thể → *giá đàm phán riêng* |

## 5.4 Một backend, nhiều mặt tiền

Mỗi **API key gắn với một channel**. Đây là điểm hay nhất về kiến trúc:

```
   Web bán lẻ  ──[khoá channel online]───┐
                                          ├──►  Spree (một backend duy nhất)
   Web bán sỉ  ──[khoá channel wholesale]─┘
```

Trang B2B và trang B2C là **hai ứng dụng dùng hai khoá khác nhau**, trỏ về **cùng một
backend**. Channel của khoá tự quyết định: xem được hàng gì, giá bao nhiêu, có phải đăng
nhập không. **Không cần viết hai hệ thống, không cần if/else theo loại khách.**

## 5.5 Dựng B2B cho dự án nhà — từng bước

1. **Settings → Sales channels → tạo channel mới**, ví dụ `Bán sỉ`.
   Đặt *Storefront access* = **Login required**, *Guest checkout* = **Not allowed**.
2. **Customers → Customer Groups → tạo nhóm** theo cách bạn quản lý đại lý —
   theo bậc (`Đại lý cấp 1`, `Cấp 2`) hoặc theo từng công ty.
3. **Products → Price Lists → tạo bảng giá**, thêm **Customer Group Rule** (+ **Volume
   Rule** nếu muốn giá theo số lượng), nhập giá, chuyển trạng thái **Active**.
4. **Xếp khách vào nhóm** — mở khách, gán customer group.
5. **Tạo API key** cho channel bán sỉ, đưa cho người làm trang B2B.
6. Cần duyệt đơn → dùng `OrderApproval` (**cần lập trình thêm**, xem dưới).

## 5.6 Cái đã có và cái phải làm thêm

| Nhu cầu | Trạng thái |
|---|---|
| Cổng chặn khách chưa đăng nhập | ✅ có sẵn, chỉ cấu hình |
| Giá theo nhóm khách | ✅ có sẵn |
| Giá theo số lượng | ✅ có sẵn |
| Giá riêng cho 1 khách | ✅ có sẵn |
| Bắt buộc có tài khoản mới mua | ✅ có sẵn |
| Mời nhiều người vào 1 tài khoản công ty | 🟡 có bảng `Invitation`, cần dựng luồng |
| Đơn cần cấp trên duyệt | 🟡 có bảng `OrderApproval`, **cần lập trình luồng tạo/duyệt** |
| Công nợ / thanh toán sau (NET 30) | 🔴 chưa có, phải tự làm |
| Báo giá (quotation) | 🔴 chưa có, phải tự làm |
| Đặt hàng theo file Excel | 🟡 có chức năng Import, cần chỉnh cho phù hợp |

---

# Phần 6 — Hướng dẫn theo vai trò

## 6.1 Chủ shop / Quản lý

**Việc hằng ngày:** xem Dashboard (doanh thu, đơn mới), duyệt đơn giá trị lớn, xem
Reports.

**Việc thỉnh thoảng:** đổi giá, tạo khuyến mãi, thêm/bớt nhân viên (Settings → Users),
xem lại bậc giá đại lý.

**Nên biết:**
- Mỗi nhân viên **một tài khoản riêng** — đừng dùng chung. Truy vết được ai làm gì.
- Xoá sản phẩm/khách thực chất là **ẩn** (soft delete), dữ liệu vẫn còn → đơn cũ không vỡ.
- Đổi giá **không** ảnh hưởng đơn đã tạo (giá được chụp lại lúc đặt hàng).

## 6.2 Nhân viên sản phẩm

**Thêm sản phẩm:** Products → New → tên, mô tả, ảnh → tạo biến thể (size/màu) → **nhập
giá cho từng biến thể** → gán danh mục → nhập tồn kho → chuyển Active.

**Nhớ:**
- Giá và tồn kho ở **biến thể**, không ở sản phẩm.
- Chưa **Active** thì khách không thấy.
- Ảnh xử lý ở tác vụ nền — chờ vài giây, chưa hiện đừng chụp lại. Xem `/jobs`.
- Nhiều sản phẩm → dùng **Import** (CSV) thay vì nhập tay.
- Muốn thêm thông tin riêng (chất liệu, bảo hành) → **Metafield Definitions**, không cần
  gọi lập trình viên.

## 6.3 Nhân viên xử lý đơn

**Luồng:** đơn mới → kiểm tra thanh toán → đóng gói → tạo Shipment, nhập mã vận đơn →
Ship. Khách tự nhận email.

**Nhớ:**
- Chưa `complete` là **giỏ hàng bỏ dở**, không phải đơn.
- Huỷ đơn → hàng tự hoàn về kho.
- Trả hàng → **Returns**, đừng sửa tay đơn cũ.
- Hoàn tiền phải làm trong Spree để số liệu khớp cổng thanh toán.

## 6.4 Nhân viên bán sỉ (B2B)

**Khách sỉ mới:**
1. Tạo tài khoản khách (hoặc để họ tự đăng ký).
2. Customers → mở khách → **gán vào Customer Group** (ví dụ `Wholesale`).
3. Xong. Giá sỉ tự áp theo bảng giá của nhóm đó.

**Đổi giá cho một nhóm:** Products → Price Lists → mở bảng giá → **Edit Prices**.
Đừng sửa giá gốc của sản phẩm — sẽ ảnh hưởng cả khách lẻ.

**Giá riêng cho một khách lớn:** tạo bảng giá mới, dùng **User Rule** trỏ đúng khách đó.

**Nhớ:**
- `Match all` = phải thoả **mọi** điều kiện. Đặt Volume Rule min 10 thì khách mua 9 cái
  **không** được giá sỉ — đây là nguồn thắc mắc phổ biến nhất.
- Bảng giá còn `Draft` thì **chưa có tác dụng**. Phải `Active`.
- Bảng giá đặt được thời gian bắt đầu/kết thúc → hẹn trước đợt giá theo mùa.

## 6.5 Lập trình viên

Đọc [DESIGN.md](DESIGN.md) trước. Vài điều cốt lõi:

**Thứ tự ưu tiên khi cần thay đổi hành vi** (đừng đảo thứ tự này):

1. **Events & Subscribers** — cho việc phát sinh (gửi thông báo, sync ERP)
2. **Swap service qua `Spree.dependencies`** — cho đổi nghiệp vụ
3. **Extension (gem)** — cho tính năng lớn
4. **Decorator** — **chỉ khi bí**, vì nó gắn chặt code vào nội bộ Spree, nâng version dễ vỡ

Trước khi thêm cột vào database, hỏi: **Metafield có giải quyết được không?**

**Quy tắc:**
- Không sửa code trong gem. Mọi thứ trong `app/`.
- Dùng `Spree.user_class` / `Spree.admin_user_class`, không hard-code `Spree::User`.
- API không lộ ID số — dùng ID có tiền tố (`prod_86Rf07xd4z`).
- Không cần Redis: hàng đợi/cache/websocket đều nằm trong PostgreSQL.

---

# Phần 7 — Dùng API

Trang khách hàng sẽ nói chuyện với Spree qua **Store API**.

## 7.1 Xác thực — dễ sai

Store API dùng header riêng, **không phải** `Authorization: Bearer`:

```bash
# ✅ đúng
curl -H "X-Spree-Api-Key: pk_..." http://localhost:3000/api/v3/store/products

# ❌ sai → 401
curl -H "Authorization: Bearer pk_..." http://localhost:3000/api/v3/store/products
```

Lấy khoá: `make api-key`

## 7.2 Hai loại API

| | Dùng cho | Đường dẫn |
|---|---|---|
| **Store API** | trang khách hàng | `/api/v3/store/` |
| **Admin API** | tích hợp nội bộ, tự động hoá | `/api/v3/admin/` |

## 7.3 Khoá gắn channel

Hệ thống hiện có 2 khoá:

```
Default                → không gắn channel
Storefront (Wholesale) → gắn channel "Wholesale"
```

Đây là cách một backend phục vụ cả B2B và B2C (mục 5.4).

## 7.4 Webhook

Muốn hệ thống khác biết khi có đơn mới → **Settings → Webhooks**, khai báo URL. Spree
gọi vào đó mỗi khi có sự kiện.

![Webhooks](screenshots/22-webhooks.png)

---

# Phần 8 — Vận hành

## 8.1 Kiến trúc đang chạy

```
Máy local (Docker)                    Server (dự kiến)
┌──────────────────────┐              ┌────────────────────────────┐
│ web       Rails+jobs │              │ nginx  :443  (TLS)         │
│ postgres  dữ liệu    │              │   └─► web    Rails+jobs    │
│ mailpit   bắt email  │              │       postgres             │
│ admin_css watcher CSS│              │  ảnh build sẵn từ GitHub   │
└──────────────────────┘              └────────────────────────────┘
```

**Không có Redis, không có worker riêng** — hàng đợi nằm trong PostgreSQL và chạy chung
tiến trình với web. Nhờ vậy stack rất nhẹ.

## 8.2 Cách đưa lên server

```bash
script/deploy ship backend    # chạy ở máy mình, không phải trên server
```

Không có CI. Deploy là một script mình chạy và ngồi xem. Nó build ảnh ở máy mình, đẩy
thẳng qua SSH vào Docker của server, sao lưu database rồi mới release, và **tự huỷ nếu
app không lên**.

Server **không bao giờ build**. Build Spree cần khoảng 2 GB RAM, mà máy đó đang chia sẻ
với 28 site khác. Lý do đầy đủ và các lệnh còn lại: [DEPLOY.md](DEPLOY.md).

## 8.3 Sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `/admin` lỗi 500, nhắc thiếu `application.css` | chưa build CSS → `make css` |
| `web` chết ngay khi bật, DB mới | Puma kéo theo hàng đợi khi thiếu bảng → `make db-prepare` |
| API trả 401 dù có khoá | dùng sai header → `X-Spree-Api-Key` |
| API channel B2B trả 401 | **đúng như thiết kế** — channel bắt đăng nhập |
| `/dashboard` trả 404 ở local | bình thường, ảnh dev không kèm dashboard React |
| Khách không nhận được email | chưa cấu hình SMTP trên server |
| Ảnh sản phẩm không hiện | tác vụ nền chưa xong → xem `/jobs` |

Danh sách đầy đủ, kèm nguyên nhân gốc: [LOCAL.md §5](LOCAL.md).

## 8.4 Việc còn phải quyết

1. **Trang khách hàng** — Next.js (Spree khuyến nghị) hay render bằng Rails?
2. **Thanh toán Việt Nam** — Stripe/PayPal/Adyen đã có gem, nhưng VNPay / MoMo /
   chuyển khoản thì **phải tự viết**.
3. **Tiền tệ** — dữ liệu mẫu đang USD, chuyển VND cần đổi ở Store và nhập lại giá.
4. **Email** — chọn nhà cung cấp SMTP (SendGrid / Mailgun / Brevo / Amazon SES).
   Demo không cần; bán thật thì bắt buộc.
5. **Duyệt đơn B2B** — bảng đã có, luồng cần lập trình.
6. **Hạ tầng** — server hiện tại còn ~725 MB RAM trong khi Spree cần ~1 GB;
   đang chạy 28 site khác. Xem [DEPLOY.md §2](DEPLOY.md).

---

# Phụ lục

## A. Địa chỉ

### Production (đang chạy thật)

| | |
|---|---|
| **Cửa hàng (khách mua)** | **https://shop.b-teka.com** |
| **Quản trị** | **https://spree.b-teka.com/admin** |
| Store API | https://spree.b-teka.com/api/v3/store/ |
| Hàng đợi | https://spree.b-teka.com/jobs |
| Kiểm tra sống | https://spree.b-teka.com/up |

### Local

| | |
|---|---|
| Cửa hàng | http://localhost:3001 |
| Quản trị | http://spree.local/admin · http://localhost:3000/admin |
| Hộp thư (bắt hết mail) | http://mail.spree.local · http://localhost:8025 |
| Hàng đợi | http://spree.local/jobs |
| Store API | http://spree.local/api/v3/store/ |

## B. Tài khoản demo theo vai trò

Tất cả dùng mật khẩu **`spree123456`**. Tạo lại bất cứ lúc nào:

```bash
docker compose -f docker-compose.dev.yml exec web bin/rails demo:seed_users
docker compose -f docker-compose.dev.yml exec web bin/rails demo:accounts   # xem lại
```

### Nhân viên — đăng nhập tại `/admin`

| Email | Vai trò | Làm được gì |
|---|---|---|
| `admin@b-teka.com` | **Quản trị** | toàn quyền, kể cả phân quyền và cấu hình |
| `manager@b-teka.com` | **Quản lý** | đơn, sản phẩm, tồn kho, khuyến mãi, bảng giá, xem khách |
| `catalog@b-teka.com` | **NV sản phẩm** | chỉ sản phẩm + tồn kho + bảng giá |
| `fulfillment@b-teka.com` | **NV xử lý đơn** | đơn, khách, tồn kho, xem sản phẩm |
| `sales_b2b@b-teka.com` | **NV bán sỉ** | đơn, sản phẩm, tồn kho, **quản lý khách & nhóm khách** |
| `support@b-teka.com` | **CSKH** | chỉ xem đơn / khách / sản phẩm |

### Khách hàng — đăng nhập qua storefront/API

| Email | Là gì |
|---|---|
| `wholesale@example.com` | **khách B2B**, đã ở nhóm `Wholesale` → được giá sỉ |
| `retail@b-teka.com` | khách lẻ → giá niêm yết |

### Đã kiểm chứng phân quyền

Chạy `node script/audit_roles.mjs` để tự kiểm tra. Kết quả hiện tại: **6/6 vai trò
đúng như thiết kế**. Cụ thể đã xác nhận:

- `catalog` **không** vào được Đơn hàng, Khách hàng, Khuyến mãi, Cấu hình
- `support` **không** vào được Tồn kho, Khuyến mãi, Cấu hình
- chỉ `admin` vào được Phân quyền và Cấu hình cửa hàng

> **Hai điều cần biết về phân quyền Spree:**
>
> 1. Tạo Role trong `/admin` mà **không gán permission set** thì người đó đăng nhập
>    được nhưng **không thấy gì**. Permission set khai báo ở
>    `config/initializers/spree.rb`.
> 2. Màn hình **Price Lists bị chặn theo `ProductDisplay`**, không phải
>    `ProductManagement`. Nghĩa là **vai trò chỉ-đọc như CSKH vẫn xem được giá sỉ.**
>    Đây là thiết kế của Spree. Nếu không muốn, bỏ `ProductDisplay` khỏi role
>    `support`.

### Khác

| | |
|---|---|
| `/jobs` | HTTP Basic: `spree` / `spree123` |

> Đây là mật khẩu **chỉ dùng cho máy local**. Trên server phải đặt mật khẩu mạnh riêng
> (`bin/rails demo:seed_users PASSWORD='...'`).

## C. Lệnh hay dùng

```bash
make help          # danh sách đầy đủ
make doctor        # kiểm tra máy
make setup         # cài lần đầu
make up / down     # bật / tắt
make logs          # xem log
make console       # Rails console
make psql          # vào database
make mail          # thử email
make api-key       # in API key
make sample-data   # nạp lại dữ liệu mẫu (gồm demo B2B)
make css           # build CSS admin
make test          # chạy test
make reset         # XOÁ SẠCH và cài lại
```

## D. Số liệu hệ thống hiện tại

| | |
|---|---|
| Bảng trong database | 153 |
| Sản phẩm / biến thể mẫu | 36 / 121 |
| Khách mẫu | 21 |
| Channel | 3 (online, wholesale, pos) |
| Market | 7 |
| Nhóm khách | 1 (Wholesale) |
| Bảng giá | 1 (Wholesale — 255 giá) |
| Phương thức vận chuyển | 12 |
| Cổng thanh toán | 3 |
| Danh mục | 24 |
