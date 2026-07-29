# Spree Design Notes

> **Đây là tài liệu gốc về Spree cho project này.** Cần hiểu Spree hoạt động ra sao,
> hoặc cần biết "muốn làm X thì sửa ở đâu" → đọc file này trước.
>
> Mọi con số / tên class / hành vi trong file này đều **verify trực tiếp trên app đang
> chạy** (Spree 5.6.1), không copy từ docs. Chỗ nào chưa verify sẽ ghi rõ `(chưa verify)`.
>
> - Cài đặt local, gotchas → [LOCAL.md](LOCAL.md)
> - Deploy production → [DEPLOY.md](DEPLOY.md)

**Version đang dùng:** Spree 5.6.1 · Rails 8.1.3 · Ruby 4.0.1 · PostgreSQL 18

---

## 1. Spree là gì

Spree là một **eCommerce engine viết bằng Rails**, phát hành dạng gem. Nó không phải
một app bạn cài rồi dùng như WordPress — nó là **một tập Rails engines được mount vào
app Rails của bạn**. App của bạn (repo này) là chủ; Spree là thư viện.

Hệ quả quan trọng:

- Code của bạn nằm ở `app/` của repo này. **Không bao giờ sửa source trong gem.**
- Muốn đổi hành vi Spree → dùng các điểm mở rộng (mục [7](#7-mở-rộng-spree-thứ-tự-ưu-tiên)).
- Nâng version Spree = đổi 1 dòng trong `Gemfile`. Càng ít can thiệp vào nội bộ Spree,
  nâng cấp càng dễ.

### Spree 5 là headless

Điểm này hay gây nhầm. Spree 5 **không còn gem storefront cho Rails**. Kiểm tra
`Gemfile` sẽ thấy: `spree`, `spree_admin`, `spree_emails`, `spree_dashboard` — không có
`spree_storefront`.

Nghĩa là **Spree không tự render trang bán hàng cho khách**. Nó cung cấp:

| Thành phần | Đường dẫn | Dùng để làm gì |
|---|---|---|
| Admin (Rails, server-rendered) | `/admin` | Nhân viên quản lý sản phẩm / đơn / khách |
| Dashboard (React SPA) | `/dashboard` | Admin thế hệ mới, gọi Admin API |
| Store API v3 | `/api/v3/store/` | **Storefront gọi vào đây** |
| Admin API v3 | `/api/v3/admin/` | Tích hợp hệ thống khác, tự động hoá |
| Job dashboard | `/jobs` | Xem/retry background jobs |
| Health check | `/up` | Load balancer / uptime monitor |

Trong repo này `config/routes.rb` có `root to: redirect('/admin')` — vào `/` là nhảy sang
`/admin`, **đúng như thiết kế**, vì chưa có storefront.

> **Quyết định cần chốt sau:** storefront cho khách sẽ là gì? Next.js dùng `@spree/sdk`
> (cách Spree khuyến nghị), hay tự render bằng Rails views trong repo này. Chưa làm gì
> ở phần này — xem [mục 9](#9-cần-gì-thì-sửa-ở-đâu).

### Các engine đang load

Verify bằng `Rails::Engine.subclasses` trên app đang chạy:

```
Spree::Core::Engine        # models, services, business logic  ← trái tim
Spree::Api::Engine         # Store API + Admin API
Spree::Admin::Engine       # /admin (Rails + Tailwind)
Spree::Dashboard::Engine   # /dashboard (serve React build)
Spree::Emails::Engine      # email giao dịch
SpreeI18n::Engine          # dịch (có tiếng Việt)
SpreeStripe::Engine        # cổng thanh toán
SpreeAdyen::Engine
SpreePaypalCheckout::Engine
SpreeDevTools::Engine      # chỉ dev/test
```

---

## 2. Bản đồ dữ liệu

Schema có **153 bảng**. Đừng cố đọc hết — chúng gom thành 8 nhóm:

```
┌─ TENANCY ────────────────────────────────────────────────────────┐
│  Store ──┬── Channel ──── ProductPublication                     │
│          ├── Market ───── MarketCountry                          │
│          └── CustomDomain                                        │
└──────────────────────────────────────────────────────────────────┘
┌─ CATALOG ────────────────────────────────────────────────────────┐
│  Product ─┬── Variant ──┬── Price ──── PriceList ── PriceRule    │
│           │             ├── StockItem                            │
│           │             └── OptionValue ── OptionType            │
│           ├── Taxon ──── Taxonomy   (danh mục, dạng cây)         │
│           ├── Asset / VariantMedia  (ảnh, video)                 │
│           └── Metafield ── MetafieldDefinition  (field tự thêm)  │
└──────────────────────────────────────────────────────────────────┘
┌─ CUSTOMER ───────────────────────────────────────────────────────┐
│  User ──┬── CustomerGroup   (phân nhóm KH → giá B2B)             │
│         ├── Address                                              │
│         ├── RoleUser ── Role     (quyền)                         │
│         ├── StoreCredit, GiftCard                                │
│         └── Wishlist                                             │
│  AdminUser  ← TÁCH RIÊNG khỏi User. Xem mục 4.                   │
└──────────────────────────────────────────────────────────────────┘
┌─ ORDER ──────────────────────────────────────────────────────────┐
│  Order ─┬── LineItem ──── Variant                                │
│         ├── Payment ───── PaymentMethod                          │
│         ├── Shipment ──┬─ ShippingRate ── ShippingMethod         │
│         │              └─ InventoryUnit                          │
│         ├── Adjustment   (thuế / giảm giá, xem mục 3.7)          │
│         ├── OrderApproval  ← B2B: đơn cần phê duyệt              │
│         └── OrderPromotion ── Promotion                          │
└──────────────────────────────────────────────────────────────────┘
┌─ INVENTORY ──┐ ┌─ TAX ────────┐ ┌─ PROMO ──────┐ ┌─ RETURNS ────┐
│ StockLocation│ │ TaxRate      │ │ Promotion    │ │ ReturnAuth   │
│ StockItem    │ │ TaxCategory  │ │ PromotionRule│ │ ReturnItem   │
│ StockMovement│ │ Zone         │ │ PromoAction  │ │ Reimbursement│
│ StockTransfer│ │ ZoneMember   │ │ CouponCode   │ │ CustomerRet. │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
┌─ PLATFORM ───────────────────────────────────────────────────────┐
│  ApiKey, RefreshToken, AllowedOrigin   (auth cho API)            │
│  WebhookEndpoint, WebhookDelivery      (bắn event ra ngoài)      │
│  Integration, DataFeed, Import, Export, Report                   │
│  SolidQueue* (job), SolidCache*, SolidCable*   ← chạy trong PG   │
└──────────────────────────────────────────────────────────────────┘
```

Tất cả model Spree đều namespace `Spree::` → `Spree::Product`, `Spree::Order`.
Bảng đều prefix `spree_`.

---

## 3. Từng domain

### 3.1 Store, Channel, Market — 3 trục khác nhau

Đây là chỗ dễ nhầm nhất, và **cũng là chỗ quyết định kiến trúc B2B/B2C**. Ba khái niệm
này độc lập nhau:

| | Trả lời câu hỏi | Ví dụ trong sample data |
|---|---|---|
| **Store** | "Đây là *doanh nghiệp* nào?" | `Shop` (1 store) |
| **Channel** | "Khách đến bằng *đường* nào?" | `online`, `wholesale`, `pos` |
| **Market** | "Bán cho *vùng* nào?" | US, Europe, Asia, Africa… (7) |

- **Store** = tenant. Nhiều store = nhiều thương hiệu riêng biệt, mỗi cái có domain
  riêng (`Spree::CustomDomain`), tiền tệ, chính sách riêng. `Spree::Store.default` là
  store mặc định.
- **Channel** (`Spree::Channel`, mới từ 5.5) = điểm bán trong *cùng* một store. Sản
  phẩm publish theo từng channel qua `Spree::ProductPublication`, nên cùng 1 catalog có
  thể lộ khác nhau ở mỗi channel.
- **Market** (`Spree::Market`) = nhóm quốc gia (`Spree::MarketCountry`), quyết định giá
  và thuế theo vùng.

Truy cập context trong request: `Spree::Current.store`, `Spree::Current.currency`,
`Spree::Current.locale`.

### 3.2 Catalog

```
Product          "Áo thun"            ← thứ khách thấy & tìm kiếm
 └── Variant     "Áo thun / L / Đỏ"   ← thứ thực sự bán, có SKU, giá, tồn kho
      └── OptionValue  L, Đỏ
           └── OptionType  Size, Color
```

Điểm quan trọng: **Price và tồn kho gắn vào `Variant`, không phải `Product`.** Product
chỉ là vỏ gom nhóm. Sản phẩm không có biến thể vẫn có 1 variant (master).

- **Taxonomy / Taxon** = danh mục dạng cây (nested set). `Taxonomy` là gốc
  ("Categories", "Brands"), `Taxon` là node. Nối product ↔ taxon qua
  `spree_products_taxons`.
- **TaxonRule** → smart collection: taxon tự động gom sản phẩm theo điều kiện.
- **Metafield / MetafieldDefinition** → thêm field tuỳ ý mà **không cần migration**.
  Cần thêm "chất liệu", "bảo hành" → dùng cái này trước khi nghĩ tới decorator.

### 3.3 Pricing — engine mạnh nhất của Spree, và là nền tảng B2B

Đây là phần quan trọng nhất nếu làm B2B. Cấu trúc:

```
Variant ──< Price >── PriceList ──< PriceRule
                      (nhóm giá)   (điều kiện áp dụng)
```

- `Spree::Price` — một mức giá của 1 variant, theo 1 currency. Có `amount` và
  `compare_at_amount` (giá gạch ngang).
- `Spree::PriceList` — một *bảng giá* có tên, có `status` (draft/active), có
  `starts_at`/`ends_at` (hẹn giờ), và `match_policy` (`all` = phải thoả mọi rule).
- `Spree::PriceRule` — điều kiện. Dùng STI (cột `type`). **6 loại, verify từ
  `Spree::PriceRule.descendants`:**

| Rule class | Áp giá khi… |
|---|---|
| `Spree::PriceRules::CustomerGroupRule` | khách thuộc nhóm KH nào đó ← **B2B tier** |
| `Spree::PriceRules::VolumeRule` | mua đủ số lượng ← **giá sỉ theo số lượng** |
| `Spree::PriceRules::ChannelRule` | vào từ channel nào (online / wholesale / pos) |
| `Spree::PriceRules::MarketRule` | khách ở market/vùng nào |
| `Spree::PriceRules::ZoneRule` | khách ở zone nào |
| `Spree::PriceRules::UserRule` | đúng user cụ thể ← **giá đàm phán riêng** |

`Spree::PriceHistory` lưu lịch sử đổi giá (phục vụ luật hiển thị giá của EU).

### 3.4 Customer — User và AdminUser là HAI thứ khác nhau

```
Spree::User        khách mua hàng      (bảng spree_users)
Spree::AdminUser   nhân viên vào /admin (bảng spree_admin_users)
```

Hai bảng riêng, hai Devise scope riêng. Đăng nhập admin ở `/admin_user/sign_in`.

> **Quy tắc code:** luôn viết `Spree.user_class` / `Spree.admin_user_class`, **không
> hard-code `Spree::User`**. Vì app có thể thay bằng class user riêng, và code Spree
> đọc qua config này.

- `Spree::CustomerGroup` + `spree_customer_group_users` → phân nhóm khách. Đây là móc
  nối vào pricing (CustomerGroupRule).
- `Spree::Role` + `Spree::RoleUser` → phân quyền. Quyền thực thi bằng **CanCanCan**
  (`config/initializers/spree.rb`).
- `Spree::Invitation` → mời người khác vào một resource với 1 role. Có
  `resource_type`/`resource_id` polymorphic → dùng được cho "mời đồng nghiệp vào tài
  khoản công ty" trong B2B.
- `Spree::StoreCredit`, `Spree::GiftCard` → tiền trong hệ thống.

### 3.5 Order — state machine

Order chạy bằng state machine. Verify từ app đang chạy:

```
states: cart → address → delivery → payment → confirm → complete
        + canceled, awaiting_return, returned, resumed
events: next, cancel, return, resume, authorize_return
```

`Spree::Order.checkout_steps` → `[:address, :delivery, :payment, :confirm, :complete]`

Hiểu thế này: **giỏ hàng và đơn hàng là cùng một record.** Một `Spree::Order` ở state
`cart` chính là giỏ hàng. Nó "trở thành" đơn khi đi hết checkout tới `complete`.

- `Spree::LineItem` → 1 dòng trong đơn, trỏ tới `Variant`, **snapshot giá lúc thêm vào**
  (giá đổi sau không ảnh hưởng đơn cũ).
- `Spree::OrderApproval` → **B2B: đơn cần phê duyệt.** Verify từ source:
  `STATUSES = %w[pending approved rejected]`, có `approver` (polymorphic), `level`,
  `note`, `decided_at`. Đây là luồng "nhân viên đặt → quản lý duyệt".
- `Spree::OrderRoutingRule` → định tuyến đơn (kho nào xử lý).

### 3.6 Payment & Fulfillment

**Payment** — states: `checkout, pending, completed, processing, failed, void, invalid,
capture_pending, void_pending`.

`Spree::PaymentMethod` là STI, gateway cài qua extension (`spree_stripe`,
`spree_paypal_checkout`, `spree_adyen` — đã có trong Gemfile). Mỗi extension thêm bảng
riêng (`spree_stripe_payment_intents`…).

**Fulfillment** — states của `Spree::Shipment`: `pending, ready, canceled, shipped`.

```
StockLocation   kho vật lý
 └── StockItem  tồn kho của 1 variant tại 1 kho  (count_on_hand)
      └── StockMovement  từng lần biến động
Shipment ── ShippingRate ── ShippingMethod ── Calculator (tính phí ship)
         └── InventoryUnit  từng đơn vị hàng
ShippingMethod ── Zone ── ZoneMember (country/state)  → ship đi đâu, giá bao nhiêu
```

`Spree::Calculator` là STI dùng chung cho cả phí ship, thuế, và promotion.

### 3.7 Tax, Promotion, Adjustment

Cả thuế và giảm giá **không sửa trực tiếp tổng đơn** — chúng tạo `Spree::Adjustment`.

```
Order.total = sum(LineItem) + sum(Adjustment)
```

Adjustment là polymorphic, nên xem được từng khoản cộng/trừ đến từ đâu. Đây là lý do
số tiền trong Spree luôn truy vết được.

- **Tax:** `TaxRate` (thuộc `Zone` + `TaxCategory`) → đơn ở zone nào, hàng thuộc
  category thuế nào → ra thuế.
- **Promotion:** `Promotion` → nhiều `PromotionRule` (điều kiện) + nhiều
  `PromotionAction` (hành động). `CouponCode` cho mã giảm giá.

### 3.8 Nền tảng

- **Background jobs = Solid Queue, chạy trong Postgres.** **Không cần Redis.** Mặc định
  supervisor chạy *bên trong* Puma (`SOLID_QUEUE_IN_PUMA`) → 1 container là đủ.
  Đây là lý do stack này nhẹ. Xem `/jobs`.
- **Cache + Cable** cũng trong Postgres (Solid Cache / Solid Cable).
- **Search** mặc định query thẳng database. Set `MEILISEARCH_URL` mới bật Meilisearch
  (chịu lỗi chính tả, facet nhanh) rồi `bin/rails spree:search:reindex`.
- **File** qua ActiveStorage — local disk, hoặc S3 / Cloudflare R2 nếu set credentials.
- **Prefixed ID:** API không bao giờ lộ ID số. `prod_86Rf07xd4z`, `appr_…`, `price_…`.
  Tra bằng `Spree::Product.find_by_prefix_id('prod_...')`.
- **Events:** `order.publish_event('order.completed')` → subscriber xử lý (mục 7).
- **Webhook:** `WebhookEndpoint` bắn event ra hệ thống ngoài. Log ở `WebhookDelivery`.

---

## 4. B2B vs B2C — phần quan trọng nhất

**Kết luận: Spree open-source làm được B2B, không cần Enterprise Edition.** Và sample
data đã dựng sẵn một demo B2B hoàn chỉnh — `make sample-data` in ra dòng
`Loading wholesale demo data...` chính là nó.

### Cách Spree phân biệt B2B và B2C

Spree **không có "chế độ B2B"**. Thay vào đó B2B được ghép từ các mảnh có sẵn:

```
        B2C  (channel "online")          B2B  (channel "wholesale")
        ─────────────────────────        ────────────────────────────
truy cập  ai cũng xem được               phải đăng nhập mới xem
checkout  cho khách lẻ (guest)           bắt buộc có tài khoản
giá       giá niêm yết                   PriceList theo nhóm KH + số lượng
duyệt đơn không                          OrderApproval (quản lý duyệt)
nhiều user không                         Invitation (mời đồng nghiệp)
```

### Demo có sẵn — đã verify trên app đang chạy

**Channel `wholesale`** có `preferences`:

```ruby
{ guest_checkout: false, storefront_access: "login_required", order_routing_strategy: nil }
```

Hai khoá này là **cơ chế cổng B2B**. Bằng chứng thực tế: gọi Store API bằng API key của
channel Wholesale mà không đăng nhập →

```
HTTP 401
{"error":{"code":"authentication_required",
          "message":"Authentication required to access this store."}}
```

Trong khi cùng endpoint đó với key của channel Online → HTTP 200, trả về 36 sản phẩm.
Sản phẩm **được publish ở cả 3 channel** (36 publication mỗi channel), nên 401 kia
đúng là do cổng đăng nhập, không phải do thiếu hàng.

**PriceList `Wholesale`** (status `active`, `match_policy: all`, **255 giá**) có 2 rule —
và vì `match_policy` là `all` nên **phải thoả cả hai**:

```ruby
Spree::PriceRules::VolumeRule        {min_quantity: 10, max_quantity: nil}
Spree::PriceRules::CustomerGroupRule {customer_group_ids: ["1"]}
```

Đọc thành câu: *"khách thuộc nhóm Wholesale **và** mua từ 10 cái trở lên → dùng bảng
giá sỉ."*

**Nhóm khách `Wholesale`** có 1 thành viên: `wholesale@example.com`.

### API key gắn theo channel

Verify được: mỗi `Spree::ApiKey` có thể gắn 1 channel.

```
Default                → channel = nil
Storefront (Wholesale) → channel = "Wholesale"
```

**Đây là điểm mấu chốt về kiến trúc.** Storefront B2B và storefront B2C là **hai app
dùng hai API key khác nhau**, trỏ về **cùng một backend**. Channel của key tự quyết định
catalog, giá, và luật truy cập. Không cần fork, không cần if/else theo loại khách.

```
        ┌──────────────────┐  pk_r3uM… (channel online)
Shop B2C│  Next.js / web   │────────────────┐
        └──────────────────┘                │   ┌────────────────┐
                                            ├──►│  Spree backend │
        ┌──────────────────┐                │   │  (repo này)    │
Shop B2B│  Next.js / web   │────────────────┘   └────────────────┘
        └──────────────────┘  pk_WGgR… (channel wholesale)
```

### Muốn dựng B2B thật thì làm gì

1. `/admin` → tạo `CustomerGroup` cho từng nhóm khách sỉ (theo tier: Bạc/Vàng, hoặc
   theo từng công ty).
2. Tạo `PriceList`, add `CustomerGroupRule` (+ `VolumeRule` nếu muốn giá theo số lượng),
   nhập giá, đổi status sang `active`.
3. Tạo `Channel` riêng cho B2B, set `storefront_access: login_required` và
   `guest_checkout: false`.
4. Tạo `ApiKey` gắn vào channel đó → đưa cho storefront B2B.
5. Cần duyệt đơn → dùng `Spree::OrderApproval`. **Lưu ý:** model và bảng đã có, nhưng
   *luồng tự động tạo approval khi nào* thì phải tự code (subscriber trên
   `order.complete`). Model không tự sinh approval. `(cần verify thêm khi làm)`
6. Cần nhiều người trong 1 công ty khách → `Spree::Invitation`.

---

## 5. Vòng đời một request

```
Khách → GET /api/v3/store/products     (kèm header X-Spree-Api-Key)
   │
   ├─ ApiKey → xác định Store + Channel
   ├─ Spree::Current.store / currency / locale được set
   ├─ storefront_access của channel: cần login? → 401 nếu chưa
   ├─ Query product: chỉ lấy cái có ProductPublication ở channel này
   ├─ Tính giá: chạy PriceRule của các PriceList đang active
   │            (nhóm KH? số lượng? channel? market?) → chọn giá đúng
   └─ Serialize, ID dạng prefixed (prod_xxx), trả JSON
```

**Auth cho Store API:** header **`X-Spree-Api-Key`**. Đã verify:
`Authorization: Bearer <key>` → **401**. Dùng `X-Spree-Api-Key: <key>` → **200**.

```bash
# đúng
curl -H "X-Spree-Api-Key: pk_..." http://localhost:3000/api/v3/store/products
```

---

## 6. Admin vs Dashboard

Có **hai** giao diện quản trị, cùng tồn tại:

| | `/admin` | `/dashboard` |
|---|---|---|
| Công nghệ | Rails views + Tailwind | React SPA (Vite) |
| Gọi dữ liệu qua | trực tiếp model | Admin API |
| Ở local (dev) | ✅ chạy | ❌ **404** — xem dưới |
| Ở production | ✅ | ✅ |

`/dashboard` **404 ở local là bình thường**: React build chỉ được bake vào *final stage*
của Dockerfile (biến `SPREE_DASHBOARD_DIST_PATH`), còn compose dev build tới
`target: dev` nên không có build đó. Dùng `/admin` khi dev.

---

## 7. Mở rộng Spree (thứ tự ưu tiên)

Làm theo đúng thứ tự này. Decorator là **cuối cùng**, không phải đầu tiên.

**1. Events & Subscribers** — cho *side effect* (gửi noti, sync hệ thống ngoài):

```ruby
# app/subscribers/spree/my_order_subscriber.rb
class MyApp::OrderSubscriber < Spree::Subscriber
  subscribes_to 'order.complete'
  def handle(event)
    order = Spree::Order.find_by_prefix_id(event.payload['id'])
    ExternalService.notify(order)
  end
end
# rồi: Spree.subscribers << MyApp::OrderSubscriber  (trong initializer)
```

**2. Swap service (Dependencies)** — cho *đổi logic nghiệp vụ*. Kế thừa service của
Spree rồi khai báo trong `config/initializers/spree.rb`:

```ruby
Spree.dependencies do |d|
  d.cart_add_item_service = 'MyApp::Cart::AddItem'
end
```

Xem danh sách swap được: `bin/rails spree:dependencies:list`.

**3. Extension (gem)** — `gem 'spree_stripe'` → `bundle install` →
`bin/rails g spree_stripe:install`.

**4. Decorator** — **chỉ khi bí**, và chỉ cho thay đổi *cấu trúc* (thêm association,
validation, scope). **Không dùng cho callback/side-effect** — dùng subscriber.

```ruby
# app/models/spree/product_decorator.rb
module Spree::ProductDecorator
  def self.prepended(base)
    base.has_many :reviews, class_name: 'MyApp::Review', dependent: :destroy
  end
end
Spree::Product.prepend Spree::ProductDecorator
```

Lý do xếp cuối: decorator gắn chặt code của bạn vào nội bộ Spree → nâng version dễ vỡ.

**Trước khi nghĩ tới decorator, hỏi: có thêm được bằng Metafield không?** (mục 3.2)

---

## 8. Rake task hay dùng

```bash
bin/rails spree:load_sample_data        # demo catalog + khách + đơn + wholesale
bin/rails spree:cli:create_admin        # EMAIL=… PASSWORD=… bắt buộc
bin/rails spree:cli:ensure_api_key      # in publishable key
bin/rails spree:cli:list_api_keys
bin/rails spree:dependencies:list       # xem service nào swap được
bin/rails spree:search:reindex          # sau khi bật Meilisearch
bin/rails spree:upgrade                 # chạy SAU khi nâng version Spree
bin/rails spree:admin:tailwindcss:build # bắt buộc, xem LOCAL.md
```

---

## 9. Cần gì thì sửa ở đâu

| Muốn làm | Sửa ở |
|---|---|
| Đổi config Spree, quyền, swap service | `config/initializers/spree.rb` |
| Thêm/bớt route, mount engine | `config/routes.rb` |
| Thêm/nâng gem, thêm extension | `Gemfile` |
| Phản ứng khi có sự kiện (đơn xong…) | `app/subscribers/` |
| Đổi logic nghiệp vụ | service mới trong `app/services/` + `Spree.dependencies` |
| Thêm field vào model | Metafield trước; hết cách thì `app/models/spree/*_decorator.rb` |
| Biến môi trường | `.env` (local) · `.env` trên server (prod) |
| Giá / bảng giá / giá sỉ | `/admin` → Price Lists (không cần code) |
| Cổng truy cập B2B | `/admin` → Channels → preferences |
| Storefront cho khách | **chưa có** — cần chốt Next.js hay Rails |

---

## 10. Những chỗ còn phải chốt

Ghi lại để không quên. Cập nhật file này khi có quyết định.

1. **Storefront**: Next.js + `@spree/sdk`, hay Rails views trong repo này?
2. **Thanh toán**: Stripe / PayPal / Adyen đã có gem — nhưng thị trường VN thường cần
   VNPay / MoMo / chuyển khoản. Chưa có gem sẵn → phải tự viết `PaymentMethod`.
   `(chưa verify có gem cộng đồng nào)`
3. **B2B approval flow**: bảng có rồi, nhưng trigger tạo approval phải tự code.
4. **Email thật**: hiện local bắt hết vào Mailpit. Prod cần SMTP thật — xem DEPLOY.md.
5. **Tiếng Việt**: `spree_i18n` đã cài. Chưa kiểm tra độ phủ bản dịch tiếng Việt.
6. **Đơn vị tiền**: sample data đang USD. Chuyển VND cần set currency ở Store + nhập giá.
