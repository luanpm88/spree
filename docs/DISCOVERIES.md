# Discoveries

Những thứ **không hiển nhiên**, đã phải trả giá bằng thời gian để biết. Mỗi mục ghi:
phát hiện được gì, tại sao lại thế, và bằng chứng.

Quy tắc của file này: chỉ ghi thứ đã **kiểm chứng trực tiếp** trên hệ thống đang chạy.
Chỗ nào chưa chắc thì ghi rõ `(chưa verify)`.

Lỗi thao tác hằng ngày → [LOCAL.md §5](LOCAL.md). Vận hành server → [DEPLOY.md §11](DEPLOY.md).

---

## 1. Về Spree

### 1.1 Storefront Rails bị bỏ ở **5.5**, không phải ở Spree 5

Bản đầu của mục này ghi "Spree 5 không có storefront cho Rails". **Sai**, và sai theo
hướng nguy hiểm nếu khách đang ở 5.2 hoặc 5.4.

Đối chiếu rubygems:

```
spree             … 5.4.4 → 5.5.0 … 5.5.4 → 5.6.0 → 5.6.1
spree_storefront  … 5.4.6 ← DỪNG. Không có 5.5, không có 5.6
```

Nghĩa là **5.2, 5.3, 5.4 VẪN CÓ** storefront chạy bằng Rails. Từ **5.5 trở đi thì
không**.

Hệ quả cho việc nâng cấp, và đây là điều lớn nhất của cả dự án: shop đang ở
5.2/5.4 có toàn bộ trang khách do Rails vẽ. Nâng lên 5.6 thì **trang đó không hỏng, nó
biến mất** — gem không còn tồn tại để mà cài.

Nên "nâng 5.4 lên 5.6" **không phải là nâng cấp**. Nó là:

```
nâng dữ liệu   (8 bước migration có sẵn)
+ viết lại toàn bộ trang khách thành app riêng gọi Store API
```

Ai nghĩ đây là "import database rồi sửa mấy thứ lặt vặt" sẽ hụt phần thứ hai, mà phần
thứ hai mới là phần tốn công.

Ở 5.6, vào `/` là redirect sang `/admin`. **Đúng thiết kế**, không phải cấu hình sai.
Dự án này dùng [spree/storefront](https://github.com/spree/storefront) (Next.js 16, MIT)
cho trang khách.

Cách kiểm lại nhanh:

```bash
curl -s https://rubygems.org/api/v1/versions/spree_storefront.json | jq -r '.[0].number'
```

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

### 1.13 Có HAI cơ chế reset mật khẩu, và chúng không hiểu nhau

Đây là phát hiện tốn nhiều thời gian nhất khi làm email chào mừng.

| | Cơ chế | Tạo token | Đọc token |
|---|---|---|---|
| Rails/Devise | `reset_password_token` (lưu digest) | `set_reset_password_token` | `reset_password_by_token` |
| **Store API** | `generates_token_for` của Rails 7.1 | `generate_token_for(:password_reset)` | `find_by_password_reset_token` |

Storefront Next.js **chỉ dùng cơ chế thứ hai**. Nó gọi
`PATCH /api/v3/store/password_resets/:id`, và controller đó đọc bằng
`find_by_password_reset_token`.

Nếu email nhúng token Devise thì mọi bước đều trông đúng:

```
link mở ra trang đúng           ✓
form 2 ô mật khẩu hiện ra        ✓
bấm submit, không lỗi mạng       ✓
→ "Password reset token is invalid or has expired"
```

Token Devise vẫn hợp lệ nếu kiểm bằng `reset_password_by_token` trong console, nên
unit test kiểu đó **pass mà tính năng vẫn hỏng**. Chỉ có test đi hết đường
(mail → click → đặt mật khẩu → đăng nhập lại) mới bắt được. Xem
`script/e2e_welcome.mjs`.

Kết luận: mọi link reset gửi cho khách qua storefront **phải** dùng
`generate_token_for(:password_reset)`.

### 1.14 `append_token` dùng `?token=`, và không tự thêm đường dẫn

`Spree::BaseMailer#append_token` chỉ gắn `?token=` / `&token=` vào URL bạn đưa nó.
Email reset mặc định không cần lo, vì storefront gửi kèm `redirect_url` khi khách bấm
"quên mật khẩu". Email chào mừng thì **không có request nào phía trước**, nên nếu chỉ
truyền `store.storefront_url` thì khách rơi vào trang chủ với một token trong URL và
không biết làm gì.

Đừng tự đoán tiền tố `/{country}/{locale}`. Next.js **tự chuyển hướng** và giữ nguyên
query:

```
/account/reset-password?token=…  →  /us/en/account/reset-password?token=…
```

Bản đầu mình lấy country từ market mặc định và ra `/ca/en/`, vì market tên "US" liệt kê
Canada trước theo bảng chữ cái.

### 1.15 `Store#default_currency` và `#default_locale` KHÔNG phải cột

Cả hai trông như cột trong bảng và không phải. `Spree::Stores::Markets` ghi đè cả hai
reader để trả lời từ **Market mặc định**:

```ruby
store.read_attribute(:default_currency)   # "NZD"  ← cột, mình vừa ghi
store.default_currency                    # "USD"  ← Market trả lời
store.method(:default_currency).owner     # Spree::Stores::Markets
```

Một cài đặt mới có sẵn Market tên "United States" với USD. Đặt cột thành NZD **không
báo lỗi, không cảnh báo**, admin chỉ đơn giản hiện dấu `$`.

Phải sửa Market, và sửa cả danh sách quốc gia của nó — một Market tên "New Zealand"
mà vẫn liệt kê US thì không phục vụ đúng ai cả.

Cách phát hiện: **đọc lại giá trị sau khi ghi**. `lib/tasks/commercial_setup.rake` in
giá trị thật cạnh giá trị cột mỗi lần chạy, để hai cái không thể lệch nhau trong im
lặng.

### 1.16 Admin không có role trên store nào thì lặp vô hạn, không báo lỗi

Tài khoản admin xác thực đúng nhưng không có `Spree::RoleUser` trên store nào sẽ:

```
302 POST /admin_user/sign_in  →  /admin_user/sign_in
302 GET  /admin_user/sign_in  →  /admin_user/sign_in     (lặp mãi)
```

Trình duyệt bỏ cuộc với `ERR_TOO_MANY_REDIRECTS`. **Log không nói gì.**

Nhớ là `admin.stores << store` sẽ raise `Role can't be blank` — `Spree::RoleUser`
không phải bảng nối thuần, nó mang theo quyền. 5.6 ship sẵn: `admin`, `manager`,
`catalog`, `fulfillment`, `sales_b2b`, `support`.

### 1.17 `BackfillFriendlyIdSlugLocale` phá dữ liệu đa ngôn ngữ

```ruby
FriendlyId::Slug.unscoped.update_all(locale: Spree::Store.default.default_locale)
```

Không điều kiện gì cả. Nó sinh ra để điền `NULL` cho shop đời cũ. Chạy nó trên shop
đã có locale đúng thì **ép hết về một giá trị**, đụng unique index mà 5.6 mới thêm, và
xoá sạch URL của những locale còn lại.

Kiểm trước khi migrate:

```sql
SELECT locale, count(*) FROM friendly_id_slugs GROUP BY 1;
```

Không có dòng `NULL` nào thì migration này **không cần chạy**, và chạy là hỏng.

### 1.18 5.6 bỏ `Spree::Property` và `Spree::ProductProperty`

Thay bằng `Spree::Metafield` + `Spree::MetafieldDefinition`, bảng khác, hình dạng
khác, và **không có script chuyển đổi nào đi kèm**.

Bảng cũ không bị xoá, nên nhìn database vẫn thấy dữ liệu và tưởng ổn. Nhưng 5.6 không
đọc chúng nữa, nên mọi thông số sản phẩm biến mất khỏi trang mà không có lỗi nào.

Chọn `LongText` chứ không phải `ShortText` nếu giá trị là danh sách nhiều dòng.

### 1.19 5.6 không có email chào mừng nào cả

`Spree::UserMailer` **không tồn tại**. Toàn bộ mailer còn lại:

```
Spree::BaseMailer  CustomerMailer  OrderMailer  ReimbursementMailer  ShipmentMailer
```

Và `CustomerMailer` chỉ có `password_reset_email`. Shop 5.2/5.4 gửi welcome email qua
`Spree::UserMailer.welcome_email` sẽ **lặng lẽ ngừng gửi** sau khi nâng cấp.

### 1.20 `payment_link_email` hỏng trong chính 5.6.1

`spree_emails` gọi `spree.checkout_state_url`, mà helper đó thuộc `spree_storefront`
— gem dừng ở 5.4.6. Trên 5.6 engine có **0 route helper checkout**, nên gọi là
`NoMethodError` và mail không bao giờ gửi.

Xem `app/mailers/spree/order_mailer_payment_link_decorator.rb`.

### 1.21 Chỉ có MỘT công tắc cho toàn bộ email khách hàng

`Spree::Store` có đúng một preference, và nó gác năm subscriber cùng lúc:

```ruby
# spree_core-5.6.1/app/models/spree/store.rb:47
preference :send_consumer_transactional_emails, :boolean, default: true
```

Gác: order (confirm + resend), shipment, reimbursement, customer, newsletter. Không
có công tắc riêng từng loại ở đâu trong 5.6.1. Tắt nó để chặn email shipped thì mất
luôn email xác nhận đơn — thường là email duy nhất khách thực sự muốn giữ.

Ngoại lệ duy nhất: `cancel_email` **không** bị preference này gác.

**Và xóa chữ trong en.yml không tắt được email.** Spree mang theo bản tiếng Anh mặc
định của chính nó cho mọi mailer, nên khi section của khách mất thì mail vẫn gửi, bằng
giọng của Spree. Khách nhận một email không ai viết, nói về việc mà hệ thống khác đang
xử lý. Tệ hơn cả hai lựa chọn gửi-chữ-của-khách hoặc không-gửi-gì.

Nơi duy nhất gọi `ShipmentMailer` / `ReimbursementMailer` trong cả `spree_core`,
`spree_admin`, `spree_api` và `spree_emails` là hai subscriber đó — đã grep hết bốn
gem. Không có nút resend nào ở admin. Nên bỏ subscriber là tắt **sạch**, không phải
tắt một nửa:

```ruby
Spree.subscribers.delete(Spree::ShipmentEmailSubscriber)   # cách Spree tự document
```

Thứ tự boot là load-bearing, cả hai đầu:

```
Bundler.require            spree_emails engine đăng ký after_initialize  → concat
load_config_initializers   block của mình đăng ký after_initialize       → delete
after: load_config_...     Spree::Events.activate! đăng ký sau nữa       → đọc array
```

Đổi chỗ bất kỳ cái nào thì switch **im lặng** ngừng hoạt động. `to_prepare` của Spree
gọi `Events.reset!` rồi `activate!`, cả hai đọc `Spree.subscribers` mới, nên class đã
xoá vẫn ở ngoài sau mỗi lần reload code.

Đo bằng cách publish event thật rồi đếm job, không đoán:

```
chưa set                          shipment.shipped → Webhook, ShipmentEmail
DISABLED_EMAILS=shipment,reimb…   shipment.shipped → Webhook
                                  order.completed  → vẫn đủ 4, có OrderEmailSubscriber
```

Biến `DISABLED_EMAILS` trong `config/initializers/spree.rb`. Là env var chứ không
hardcode: 4 trong 7 shop sắp migrate là bán lẻ (nz, au, us, ca), chúng gửi hàng thật và
**cần** email shipped. Chỉ shop B2B mới đẩy fulfilment ra ngoài.

### 1.22 `auto_capture` bật sẵn, nên thanh toán offline đánh dấu đơn ĐÃ TRẢ khi chưa có tiền

Đây là cái bẫy đắt nhất tìm được trong phần payment, và nó im lặng hoàn toàn.

```ruby
# spree_core-5.6.1/lib/spree/core/configuration.rb:39
preference :auto_capture, :boolean, default: true
```

Payment method để trống cột `auto_capture` của nó thì **thừa hưởng** global:

```ruby
# app/models/spree/payment_method.rb:179
auto_capture.nil? ? Spree::Config[:auto_capture] : auto_capture
```

Và `auto_capture?` quyết định purchase hay chỉ authorize:

```ruby
# app/models/spree/payment/processing.rb:12
payment_method&.auto_capture? ? purchase! : authorize!
#   purchase!  → gateway_action(source, :purchase,   :complete)  → state completed
#   authorize! → gateway_action(source, :authorize,  :pend)      → state pending
```

Với method offline thì **không có gì để gọi**, nên gem tự trả lời thành công:

```ruby
# app/models/spree/payment_method/check.rb
def purchase(*) = simulated_successful_billing_response
```

Payment vào `completed` → `payment_total` đếm nó → `payment_state` suy ra từ số còn
lại (`order_updater.rb:196`) → thành **`paid`**.

Nghĩa là: khách đặt xong, chưa chuyển đồng nào, admin ghi **đã trả**. Với shop dùng
Bank Transfer đặt cọc rồi trả phần còn lại thì đây là sai sót kế toán nghiêm trọng,
vì hệ thống của khách sẽ xuất hoá đơn cho số tiền Spree tưởng đã nhận.

Sửa: bỏ tick `auto_capture` trên payment method đó. Là cột thật, có trong
`permitted_attributes.rb:176`, sửa được từ form admin, không cần code.

5.6.1 core **không có** Bank Transfer. Chỉ có `PaymentMethod::Check` và
`PaymentMethod::StoreCredit`. Check chính là method offline và hành vi đúng như trên.

**Và cọc rồi trả phần còn lại thì Spree làm sẵn rồi**, không cần code:

```ruby
# app/models/spree/payment.rb:356  split_uncaptured_amount
# capture! một phần → tạo payment thứ 2 state 'pending' cho phần còn lại,
# cùng method/source, rồi authorize!, và hạ amount payment đầu về số đã thu.
```

Đính chính một điều mình từng ghi sai: `void` chuyển sang **`void`**, không phải
`failed`. `failed` là của `event :failure`, đi từ `[:pending, :processing]`.

### 1.23 CBM tính theo PACKAGE, không theo ORDER — và splitter chia sẵn theo shipping category

`Spree::Stock::Package#volume` là `contents.sum(&:volume)` (`package.rb:101`). Một
order **không phải** một package:

```ruby
# spree_core-5.6.1/lib/spree/core/engine.rb:150
stock_splitters = [
  Spree::Stock::Splitter::ShippingCategory,   # ← mặc định, đang bật
  Spree::Stock::Splitter::Backordered,
  Spree::Stock::Splitter::Digital
]
```

Nên bình một shipping category, ly một category khác → đơn 15 CBM thành **hai** package
7.5 CBM. Mỗi package đọc ra "pallet" trong khi cả đơn là "container". Sai theo hướng
làm mất tiền, và trên màn hình không có gì trông sai.

Cộng thêm `Variant#volume` là `(width||0)*(height||0)*(depth||0)` — **không có đơn vị
nào**. Xem [1.21](#) về `catalogue:audit` và bản sửa importer.

**Shipping method hiện ra hay không là giao của NĂM điều kiện** (`stock/estimator.rb:61`):

```ruby
package.shipping_methods.select do |m|
  m.available_to_display?(display_filter) &&
    m.include?(order.ship_address) &&        # ← zone phải chứa địa chỉ
    m.calculator.available?(package) &&
    (m.calculator.preferences[:currency].blank? ||
     m.calculator.preferences[:currency] == currency)
end
```

Thiếu bất kỳ điều kiện nào thì method **biến mất không thông báo gì**. Với shop bán sỉ
đi nhiều nước, `zone` là cái sẽ cắn: địa chỉ ngoài mọi zone thì checkout không có lựa
chọn vận chuyển nào và dừng, không nói lý do.

`cost` của shipment **không** nằm trong `@@shipment_attributes`
(`permitted_attributes.rb:240`), nên không có sẵn field để nhập giá freight bằng tay.
Và cho phép nó cũng sai, vì phí ship bị tính lại mỗi khi đơn thay đổi. Cách đúng: lưu
báo giá trên order (`private_metadata`), rồi calculator đọc ra qua `package.order` —
nhớ nil-guard, vì `Package#order` dò động qua inventory unit và có thể trả nil
(`package.rb:33`).

---

### 1.24 Một dòng calculator mồ côi làm SẬP cả trang Shipping Methods, không chỉ hỏng báo giá

Shop cũ migrate lên thường mang theo calculator tự viết. Nếu class đó không còn,
`spree_calculators.type` trở thành chuỗi không constantize được. Trực giác nói "thì
method đó không quote được thôi". Đo thật thì rộng hơn nhiều:

| Truy vấn | Kết quả |
|---|---|
| `Spree::ShippingMethod.all.to_a` | chạy bình thường |
| `Spree::Calculator.count` | chạy bình thường |
| `Spree::Calculator.all.to_a` | **RAISE** `SubclassNotFound` |
| `ShippingMethod.includes(:calculator)` | **RAISE** `SubclassNotFound` |

Dòng cuối là đúng truy vấn màn hình admin Shipping Methods dùng. Nên **một** dòng hỏng
làm 500 cả trang, kể cả các method hoàn toàn lành. Vì `count` và `all.to_a` cho kết quả
khác nhau, health check đếm số dòng sẽ báo xanh trong khi admin đang sập.

Vá mà không phá dữ liệu: đổi `type` sang một class core tương đương, **không xoá dòng**.
Với "free postage" thì `Spree::Calculator::Shipping::FlatRate` là tương đương chính xác,
`preferred_amount` mặc định `0.0` nên `compute` trả về `0.0`. Cột `preferences` giữ nguyên,
nên đổi ngược lại lúc nào cũng được.

```sql
UPDATE spree_calculators SET type = 'Spree::Calculator::Shipping::FlatRate'
WHERE type = 'Spree::Calculator::Shipping::<TênClassĐãMất>';
```

Kiểm trước khi đổi: nếu `preferences` KHÔNG rỗng thì có cấu hình sẽ bị bỏ qua, phải đọc
kỹ chứ đừng đổi mù. `script/check_sti_classes.rb` quét sẵn mọi cột STI để tìm các dòng này.

### 1.25 Zeitwerk và viết tắt: file client load được hay không là chuyện HOA THƯỜNG

Class calculator do shop tự viết hay đặt tên kiểu `UBICaShippingCalculator`. Zeitwerk suy
constant từ tên file, `ubi_ca_shipping_calculator.rb` ra `UbiCaShippingCalculator`, lệch
đúng hai chữ hoa. Cài file vào rồi mà class vẫn "mất" y như chưa cài — và vì
`compute_package` thường có `rescue => e; 0.0`, hậu quả không phải lỗi mà là **phí ship $0**.

Cạm bẫy nằm ở cách sửa. Cách hiển nhiên:

```ruby
inflect.acronym 'UBI'      # ĐỪNG
```

`acronym` có phạm vi TOÀN CỤC, nên nó sửa file này và đồng thời làm hỏng file anh em
`ubi_nz_shipping_calculator.rb` (class đó viết `UbiNz`, camel thường). Sửa shop A gãy shop B.
Phải giới hạn đúng một basename:

```ruby
# config/initializers/inflections.rb
Rails.autoloaders.each do |autoloader|
  autoloader.inflector.inflect('ubi_ca_shipping_calculator' => 'UBICaShippingCalculator')
end
```

Đừng đổi tên class cho khớp Zeitwerk: chuỗi đó nằm trong `type` của mọi dòng calculator
trong dữ liệu production, đổi class nghĩa là phải UPDATE dữ liệu thật để chữa một việc mà
ba dòng config giải quyết xong.

### 1.26 Class STI mất: có hai loại, và chỉ MỘT loại làm gãy admin

Cùng là "class không constantize được", nhưng hậu quả khác hẳn, và phân biệt được thì
đỡ mất thời gian chữa thứ không hỏng:

| Trường hợp | Ví dụ | Hậu quả |
|---|---|---|
| Class con mất, **class gốc còn** | `Calculator::Shipping::X`, `PaymentMethod::Y` | `Base.all.to_a` và `includes(:assoc)` **RAISE** → sập trang admin |
| **Cả model không tồn tại** | `Spree::Page`, `Spree::Theme` khi không cài gem storefront | các dòng đó **trơ**, không code nào chạm tới được |

Loại thứ hai kiểm bằng chính class gốc: nếu `Spree::Page` báo `NameError` và
`store.pages` báo `NoMethodError` thì không có association nào nạp chúng, nên dù bảng
có hàng nghìn dòng type lạ cũng không ảnh hưởng gì. Đừng đụng vào, và nhất là đừng xoá.

Công cụ quét chỉ liệt kê type không constantize được, nên nó gộp cả hai loại lại. Bước
tiếp theo luôn là hỏi: class GỐC có tồn tại không.

### 1.27 5 migration báo FAILED trên đường 5.2.5 → 5.6.1 mà schema vẫn đúng

`CreateSpreeDigitalLinks`, `RenameSecretToTokenOnSpreeDigitalLinks`,
`RenameDataFeedTableColumns`, `AddIndexesToDataFeedsTable`,
`RenameDataFeedsColumnProviderToType` đều fail với `PG::UndefinedColumn`. Cả hai shop
đã thử đều fail y hệt, nên đây là đặc tính của đường nâng cấp chứ không phải dữ liệu bẩn.

Lý do: bảng đích đã tồn tại sẵn ở hình dạng CUỐI. `spree_digital_links` đã có `token`
chứ không còn `secret`, `spree_data_feeds` đã có `store_id/type/slug/active`. Các
migration đổi tên vì thế không còn gì để đổi.

Đừng tin cái nhãn FAILED, mà **so schema với một database 5.6.1 sạch**:

```bash
# cột nào bản sạch CÓ mà shop migrate THIẾU — con số này phải là 0
comm -23 <(cols clean) <(cols migrated)
# rồi so tiếp index, vì so cột không nhìn thấy index thiếu
comm -23 <(idx clean) <(idx migrated)
```

Thực tế: 0 cột thiếu, 1 index thiếu (`spree_reimbursements.performed_by_id`, cột có
sẵn nhưng index không được tạo, thiếu ở cả hai shop). Sau khi xác minh xong thì thêm
index và ghi 5 version vào `schema_migrations`, nếu không `check_all_pending!` sẽ báo
`PendingMigrationError` mãi.

### 1.28 Migration 5.6 chuyển product properties sang metafields, nhưng bỏ sót

Trên shop thử: 416 property, migration lõi tự chuyển 388, còn **28 cái không có
metafield nào**. Không có lỗi, không có cảnh báo. Nếu bỏ qua bước
`properties:export` trước khi migrate thì 28 property đó biến mất lặng lẽ và không
lấy lại được, vì bảng cũ đã hết là nguồn đọc.

Bảng `spree_product_properties` vẫn còn nguyên dữ liệu sau khi migrate, và
`Spree::ProductProperty` thì **không còn tồn tại** trong 5.6.1 — model đã bị bỏ. Nên
`ProductProperty.count` báo `NameError` là đúng, không phải mất dữ liệu. Kiểm bằng SQL thô.

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

### 2.10 `restart: unless-stopped` KHÔNG sống sót qua reboot của máy chủ

Đây là phát hiện đắt nhất của cả dự án: **Spree sập 5 ngày mà không ai biết.**

Máy chủ reboot ngày 2026-08-05 để nâng kernel. Trình tự tắt máy dừng container, và
Docker ghi nhận đó là **dừng có chủ ý**. Khi daemon khởi động lại, `unless-stopped`
đúng theo tên của nó: nó từ chối bật lại thứ đã bị dừng. Kết quả là hai tên miền trả
502 suốt từ đó tới 2026-08-10.

```yaml
restart: always          # đúng
# restart: unless-stopped   # sai, sẽ nằm im sau reboot
```

Hai bài học tách biệt, đừng gộp:

1. **Chọn đúng chính sách restart.** `unless-stopped` chỉ hợp lý khi bạn thật sự muốn
   một lần `docker stop` thủ công được tôn trọng qua reboot. Với dịch vụ chạy thật thì
   gần như luôn là `always`.
2. **Không có giám sát thì không có sự cố nào tồn tại.** Cái sửa được ở dòng YAML,
   nhưng cái khiến nó kéo dài 5 ngày là **không có gì báo động**. Một cái ping vào
   `/up` là đủ. Xem `docs/PLAN.md`, mục `task_uptime_monitor`.

### 2.11 Cross-build arm64 → amd64 có thể chết vì lỗi QEMU

`script/deploy ship` build trên máy Mac rồi đẩy sang server amd64. Stage dashboard chết:

```
node: ../deps/uv/src/unix/linux.c:1430: uv__io_poll:
      Assertion 'errno == EEXIST' failed.  Aborted (core dumped)   exit 134
```

Đây là lỗi giả lập QEMU, không phải lỗi code. **Chưa giải quyết được.** Hệ quả thực tế:
mọi bản vá đều không lên được production, kể cả bản sửa `solid_cable` ở §1.10. Hai
hướng: `colima --vz-rosetta` (phải tạo lại VM), hoặc build ngay trên một máy amd64.

### 2.12 `git archive` đánh mất đúng những file quan trọng nhất

Deploy bằng `git archive` gửi HEAD, nên **mọi thứ trong `.gitignore` không đi theo**.
Với repo public thì đó chính là tài sản của khách: template email, file ngôn ngữ, code
tính cước.

App vẫn chạy. Nó chỉ **rơi về mặc định của framework** và trông bình thường.

> Lý do một file bị gitignore chính là lý do deploy dựa trên git đánh mất nó.

Bất kỳ deploy nào tôn trọng `.gitignore` đều cần **một kênh thứ hai**. Xem
`CLIENT_ASSETS` trong `script/commercial`.

Cách kiểm: đừng tin cây thư mục trên máy mình, hỏi thẳng server.

### 2.13 `NEXT_PUBLIC_*` là biến lúc BUILD, không phải lúc chạy

Next nhúng chúng vào bundle khi build. Đặt trong `environment:` của compose thì
**không có tác dụng gì, và không báo gì cả** — nhìn như đã cấu hình mà chưa.

Phải khai `ARG` trong Dockerfile và truyền qua `build.args`.

### 2.14 Storefront ghi cứng logo Spree

`Header.tsx` để `src="/spree.png"`, nên **mọi shop** dựng từ storefront này đều đeo
logo của framework. Hero và footer cũng mang nội dung demo, phần lớn được chính tác
giả Spree đánh dấu `{/* Demo-only: Remove for production. */}`.

Hai bẫy khi gỡ:

- Dòng bản quyền là **JSX hardcode**, không dùng khoá dịch. Sửa file ngôn ngữ không
  đổi được gì trên trang.
- Xoá chữ trong file dịch để lại **nút trống**. Phải xoá cả khối.

Và kiểm tra bằng `innerText` **không nhìn thấy logo**, vì logo là ảnh. Xem
`script/check_storefront.mjs`, nó đọc cả `src` và `alt`.

### 2.15 Trang checkout không đọc token từ URL

Link trong `payment_link_email` được mở bởi người **chưa đăng nhập, trên máy chưa từng
giữ cookie giỏ hàng**. Trang checkout chỉ tìm giỏ qua cookie, nên đúng người mà email
nhắm tới lại là người duy nhất nó không phục vụ được.

Sửa ở `getCart` (nhận token tường minh, thắng cookie) và `getCheckoutOrder` (hỏi đúng
giỏ đó theo id **trước**, vì hỏi cookie trước sẽ trả `null` rồi dừng).

Cách kiểm duy nhất đáng tin: mở link trong context trình duyệt **không có cookie nào**.

---

---

### 2.16 `docker compose` mặc định KHÔNG mount source — sửa code xong test vẫn chạy code cũ

Repo có ba file compose và chúng khác nhau ở đúng chỗ nguy hiểm nhất:

| File | web service | mount |
|---|---|---|
| `docker-compose.yml` (mặc định) | `image: ghcr.io/spree/spree:latest` | chỉ `storage` |
| `docker-compose.dev.yml` | `build: .` | `- .:/rails` |

`docker compose exec web ...` không có `-f` sẽ dùng file mặc định, tức **image dựng sẵn**.
File vừa viết trên máy không có trong container, mà lệnh vẫn chạy trơn tru và in ra kết quả
trông như thật. Đã dính nhiều lần, mỗi lần đều mất thời gian đi tìm lỗi ở chỗ không có lỗi.

Dấu hiệu nhận ra ngay: `docker compose exec web ls <file vừa tạo>` báo No such file, hoặc
`docker inspect` chỉ thấy đúng một mount là `storage`.

Hai đường đúng: dùng `-f docker-compose.dev.yml`, hoặc `docker compose cp` file vào rồi
`restart web`. Bản `cp` chỉ sống trong lớp ghi của container: `restart` giữ, `up -d` /
`--force-recreate` xoá sạch. Đây cũng là cách các file client (calculator, initializer) lên
được server: `docker buildx build` lấy cả THƯ MỤC làm context nên file gitignore vẫn vào
image — build context là thư mục, không phải git index.

### 2.17 Turbopack phục vụ CSS cũ qua cả lần khởi động lại container

Sửa biến màu trong `globals.css`, restart container, đo lại: một phần đổi, một phần vẫn
giá trị cũ. Cụ thể thang `--color-gray-*` trong `@theme` đã cập nhật, còn `--foreground`
và `--muted-foreground` trong `:root` thì không, dù nằm cùng một file và chỉ được khai
đúng một lần.

Không phải đua biên dịch: đo lại nhiều lần vẫn thế. `.next` là **named volume** nên sống
qua restart, và Turbopack phục vụ lại chunk CSS đã dựng.

Nguy ở chỗ nó **im lặng**: trang vẫn 200, vẫn có màu, chỉ là sai màu. Nếu tin vào ảnh
chụp thì kết luận "đổi không ăn" rồi đi sửa nhầm chỗ.

Ép dựng lại rẻ nhất là chạm vào file:

```bash
printf '\n/* rebuild %s */\n' "$(date +%s)" >> src/app/globals.css
```

Cách chắc chắn hơn là hỏi trình duyệt giá trị đã tính, đừng nhìn ảnh:

```bash
node script/check_theme_applied.mjs      # đọc computed style, đối chiếu bảng màu
```

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

### 3.6 Sender phải thuộc domain đã authenticate, nếu không mail im lặng không tới

`b-teka.com` chưa authenticate trong SendGrid → gửi dưới dạng `store@b-teka.com` (giá
trị mặc định trong template) bị từ chối / vào spam. **Spree không cảnh báo gì** — mail
chỉ đơn giản là không tới.

Phải kiểm tra trước khi chọn sender:

```bash
curl -H "Authorization: Bearer $KEY" https://api.sendgrid.com/v3/verified_senders
curl -H "Authorization: Bearer $KEY" https://api.sendgrid.com/v3/whitelabel/domains
```

Đã chọn `soft.support@hoangkhang.com.vn` vì `hoangkhang.com.vn` có `valid=true`.

### 3.7 `deliver!` không lỗi ≠ mail đã tới

SMTP trả OK chỉ nghĩa là nhà cung cấp đã **nhận**. Bounce chỉ thấy khi query activity
log. Test password-reset thật trả về:

```
status: not_delivered
bounce: 550 5.1.1 User does not exist - <retail@b-teka.com>
```

Không phải lỗi cấu hình — `retail@b-teka.com` là **địa chỉ demo không tồn tại**. Nhưng
nếu chỉ nhìn `DELIVERED OK` từ script thì đã kết luận sai là email hoạt động với mọi
địa chỉ.

### 3.8 Tài khoản SendGrid đang dùng chung với hệ thống thật

Lúc cấu hình, tài khoản này đang gửi ~540 mail/ngày cho một sản phẩm khác. Volume Spree
nhỏ nên không ảnh hưởng, nhưng **bounce/spam từ Spree tính vào reputation chung**.

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
| Cross-build arm64→amd64 chết vì QEMU, chưa ship được bản vá nào | §2.11 |
| Chưa có giám sát uptime — đã trả giá 5 ngày sập | §2.10 |
| Chưa có cổng thanh toán VN (VNPay/MoMo) | phải tự viết `PaymentMethod` |
| Tiền tệ đang USD | đổi VND phải nhập lại giá |
| Luồng duyệt đơn B2B | bảng `OrderApproval` có sẵn, luồng phải tự code |
| Độ phủ bản dịch tiếng Việt | `spree_i18n` đã cài, chưa kiểm tra |
