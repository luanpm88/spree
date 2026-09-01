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

## 5. Nâng cấp lên 5.6 để trống ba cột dẫn xuất

Phát hiện 14/8 khi dựng shop Canada trên server mới. **Ảnh hưởng cả 6 shop.**
Không cái nào bị checklist bắt, vì checklist chỉ hỏi trang có trả 200 hay không.
Cả ba đều tìm ra bằng cách **nhìn ảnh chụp màn hình**.

Chung một kiểu: 5.6 chuyển thứ trước đây tính động thành cột lưu sẵn, bản nâng cấp
thêm cột nhưng không điền. Không có exception, không lệch số dòng, không khoá ngoại
nào treo. Shop lên hoàn chỉnh và **rỗng**.

Sửa bằng `bin/rails backfill:all` (`lib/tasks/backfill_after_upgrade.rake`).
Phải chạy theo đúng thứ tự đó, lý do ở 5.4.

### 5.1 `spree_products.store_id` — sản phẩm không thuộc shop nào

5.6 bỏ quan hệ nhiều-nhiều qua `spree_products_stores`, thay bằng cột trên chính dòng:

```ruby
scope :for_store, ->(store) { where(store_id: store.id) }
```

Bảng nối vẫn còn nguyên 89 dòng nên mọi phép đếm đều đúng. Nhưng admin hiện
**"No Product found"** với 79 sản phẩm trong database.

Không chỉ sản phẩm. Trên Canada còn thiếu: `spree_taxons` 74/74 (toàn bộ danh mục),
`spree_payment_methods` 5/5, `spree_promotions` 3/3, `spree_role_users` 2/3.

Lấy store từ chính bảng nối cũ, vì đó là câu trả lời của khách và nó sống sót qua
nâng cấp. Chỉ khi không có bảng nối mới rơi về "store duy nhất", và **từ chối đoán**
nếu database có nhiều hơn một store.

### 5.2 `media_count` — ảnh có đủ nhưng bị coi như không có

`Spree::Product#has_media?` đọc cột `media_count` chứ không đếm ảnh:

```ruby
def has_media?
  return variant_images.any? if association(:variant_images).loaded?
  media_count.positive?
end
```

`media_count` do callback `after_create` trên `Spree::Asset` duy trì. Restore từ dump
là `INSERT` thẳng, callback không bao giờ chạy, nên cột bằng 0 trên mọi dòng.

Hệ quả: `find_variant_for_images` trả `nil`, `primary_media` trả `nil`, sản phẩm có
4 ảnh **tải được 4/4 trên trang sửa** vẫn hiện placeholder ở mọi danh sách.

`reset_counters` của Rails không đụng tới nó — đây không phải `counter_cache` khai báo
qua `belongs_to`. Phải tính lại bằng SQL theo đúng quy tắc trong
`Spree::Asset#increment_viewable_media_count`: ảnh gắn variant tính cho **cả** variant
lẫn product của nó.

### 5.3 `primary_media_id` — có ở CẢ variant lẫn product

Cả `spree_variants` và `spree_products` đều mang cột này, mỗi bên có
`update_thumbnail!` riêng. Chỉ chạy cho variant thì được một shop mà **trang sản phẩm
hiện đủ ảnh còn danh sách sản phẩm toàn placeholder** — vì danh sách đọc cột của
product, còn trang chi tiết đi vòng qua variant.

### 5.4 Thứ tự bắt buộc: store_id → counters → thumbnails

`Product#update_thumbnail!` tìm ảnh qua `find_variant_for_images`, hàm này hỏi
`has_media?`, hàm này đọc `media_count`. Chạy `thumbnails` trước `counters` thì nó
**điền được đúng 0 dòng và báo thành công**.

### 5.5 Ảnh đại diện phải là ảnh CÓ FILE

`update_thumbnail!` lấy ảnh đầu theo `position`, không quan tâm file có tồn tại không.
Với shop mà ảnh nằm ở dịch vụ lưu trữ không với tới được, mỗi thumbnail là một lỗi
500: Rails ném `KeyError: Missing configuration for the mirror Active Storage service`
ngay giữa lúc render danh sách. Một trang admin dính 22 lỗi.

`backfill:usable_thumbnails` chọn ảnh đầu tiên **có file trên đĩa**, chỉ để `NULL` khi
không ảnh nào của sản phẩm đó về được. Không xoá dòng nào: `spree_assets` giữ nguyên,
chờ ngày lấy được file từ server cũ.

---

### 5.6 Channel và product_publications — mặt tiền rỗng, đây là cái nặng nhất

Phát hiện 14/8 khi dựng storefront. **Bốn cái trên chỉ ảnh hưởng admin. Cái này
ảnh hưởng người mua.**

5.6 thêm khái niệm *channel*: một sản phẩm chỉ lộ ra với Store API thông qua dòng
`Spree::ProductPublication` nối nó với channel. Bản nâng cấp **không tạo channel
nào và không xuất bản gì**:

```
spree_channels              0 dòng
spree_product_publications  0 dòng
```

trên cả 7 shop, tổng **353 sản phẩm đang active**. Admin trông đúng, API trả
`HTTP 200`, và `data` là mảng rỗng. Storefront hiện **"No products found"** trên
shop có 57 sản phẩm.

Sửa bằng `bin/rails backfill:channel`, dùng chính `Channel#add_products` của Spree
để dòng publication được tạo đúng cách, và callback `promote_first_channel_to_default`
tự đánh dấu channel mặc định.

Chỉ xuất bản sản phẩm `status = 'active'`. Nháp và lưu trữ để nguyên — chúng cũng
không xuất bản trong admin, đẩy lên là đưa hàng chưa xong ra trước mặt khách.

### 5.7 Bốn shop không có publishable key nào

Không có key thì mọi request Store API trả `401`, tức không có storefront. Bốn
trong sáu shop rơi vào tình trạng đó, vì key chỉ sinh ra khi lần đầu dựng
storefront, mà các database này có trước việc đó. `backfill:channel` tạo luôn nếu
thiếu, để không thể publish một shop có channel nhưng không có đường đọc.

Header xác thực là **`X-Spree-Api-Key`**, không phải `X-Spree-Publishable-Key`.

### 5.8 `spree_stores.url` vẫn là tên miền thật trên bản copy

Spree sinh **mọi URL tuyệt đối** từ cột này, không phải từ host của request. Nên
bản review trả về URL ảnh, link canonical và chân email trỏ về shop khách đang
dùng thật.

Hậu quả cụ thể: Store API trả ảnh trên tên miền live, storefront review **tải ảnh
từ site thật**, và Next.js chặn hết vì host đó không nằm trong `remotePatterns`
(dựng từ `SPREE_API_URL` lúc build) — 22 request ảnh lỗi 400 trên trang vừa mới
chạy được.

`script/shop_host` đổi cột này sang tên miền tạm khi restore và lưu giá trị gốc
vào `/srv/<shop>/.original-store-url`, vì lúc chuyển thật phải trả lại đúng như cũ.

---

### 5.9 Bộ đếm danh mục — hai phần ba điều hướng biến mất

Phát hiện 14/8. **Cái thứ sáu cùng kiểu, và là cái thứ hai chạm tới người mua.**

`spree_taxons.products_count` do callback của Spree quản, không phải `counter_cache`
chuẩn của Rails, nên vòng nội suy trong `backfill:counters` không nhìn thấy, và bản
restore không bao giờ chạy callback đó.

Trên shop lớn nhất: **72/87 danh mục ghi `products_count = 0`** trong khi thực có sản phẩm.
`eco-values/non-toxic` ghi 0, thực tế 37. Store API lọc danh mục theo con số này, nên
phần lớn điều hướng rỗng trong khi admin trông hoàn toàn bình thường.

Sửa bằng `bin/rails backfill:counters`, gọi chính `Spree::Taxon.recalculate_products_count`.
**Tuyệt đối không đếm bằng `COUNT(*)`**: con số này tính **gộp cả danh mục con**, nên
đếm tay sẽ sai ở mọi danh mục có con.

Đã sửa trên cả 6 shop, từ 12 tới 84 danh mục mỗi shop — tổng **393 danh mục**.

### 5.10 Store API không phục vụ danh mục theo quy tắc

Không phải lỗi, là giới hạn, và **không sửa được bằng dữ liệu**. Danh mục có
`automatic = true` bị Store API 5.6 loại hoàn toàn.

Con số khớp tuyệt đối: database 87 danh mục, API trả 85, chênh đúng 2 — và 2 cái đó
là toàn bộ danh mục tự động của shop. Mỗi shop bán lẻ có đúng 2; shop nhỏ nhất có 0.

Đáng lo vì một trong hai là `collections/on-sale`, tức **carousel "On Sale" trên
trang chủ khách hàng**. Hai đường xử lý: đổi nó thành danh mục thủ công, hoặc để
storefront tự lọc theo giá. Payload sản phẩm có `price` và `original_price`, nên
`original_price > price` là ra hàng giảm giá — 35 sản phẩm trên shop đó.

### 5.11 Phân trang danh mục không có `sort` thì mất dữ liệu, im lặng

`per_page` bị chặn cứng ở **25** cho danh mục, không nâng được.

Nguy hiểm hơn: **không truyền `sort` thì các trang chồng lấn nhau**. Đọc đủ 4 trang
của 85 bản ghi chỉ ra **62 bản ghi duy nhất** — mất 27%, không lỗi, không cảnh báo.
Thêm `sort=permalink` thì ra đủ 85.

Điều này suýt làm tôi báo nhầm rằng khách mất 25 danh mục. Bài học chung: **bất kỳ
đoạn code nào liệt kê qua phân trang mà không ép thứ tự đều đang mất dữ liệu.**

Header xác thực là `X-Spree-Api-Key`. Lọc theo danh mục là `in_category=<id>`, và
phải là **ID dạng `ctg_...`**, đường dẫn permalink bị bỏ qua âm thầm.

---

### 5.12 Tệp đính kèm trùng tên giữa các task, ghép theo tên là ghép nhầm

Mỗi task shop đính kèm một bộ ảnh cùng vai trò: logo, favicon, ảnh About. Tải cả
project về một thư mục thì trình duyệt tự thêm `(1)`, `(2)` vào tên trùng, và hai
tệp **khác nội dung** có thể mang cùng một tên gốc: hai shop cùng gửi
`frontimage.jpg` nhưng là hai tấm khác nhau.

Ghép theo tên cho ra kết quả sai mà không báo lỗi gì. Ba tấm của shop bán sỉ đã
lên shop bán lẻ theo đúng cách đó: logo đen có dấu ® thay cho wordmark màu thương
hiệu, favicon 260 thay 180, và ảnh kho hàng thay ảnh sản phẩm.

**Cách đúng:** API tệp của tracker trả `md5` cho từng tệp. Ghép bằng md5 giữa
tệp trên đĩa và tệp thuộc task, rồi mới đặt tên lại theo vai trò. Tên tệp chỉ để
người đọc, không dùng làm khoá.

### 5.13 Ô mã tuỳ chỉnh thứ ba, chỉ một task có

Năm task ghi hai ô: trong `head` và trước khi đóng `body`. Task thứ sáu ghi ba,
thêm "after opening body tag", và đó là chỗ đặt banner xin phép cookie.

Dựng theo năm task đầu rồi coi như xong là mất hẳn ô thứ ba. Với banner cookie
thì đặt sai chỗ còn tệ hơn không đặt: banner chạy sau khi mọi thứ đã tải xong là
banner xin phép cho việc đã rồi.

**Bài học chung:** đọc hết mọi task rồi mới chốt cấu trúc, đừng suy ra cấu trúc
từ vài task đầu.

### 5.14 Thư viện đo đạc của nhà cung cấp hosting trả 404 khi tự host

Mẫu storefront kèm sẵn `@vercel/analytics` và `@vercel/speed-insights`. Hai cái
này chèn thẻ script trỏ tới `/_vercel/insights/script.js`, đường dẫn chỉ tồn tại
khi chạy trên Vercel. Trên máy chủ của khách, **mỗi lượt tải trang gọi hai đường
dẫn trả 404** và không báo số liệu về đâu cả.

Không có lỗi trên màn hình, không có cảnh báo khi build. Chỉ thấy khi chụp trang
bằng Playwright và ghi lại mọi phản hồi >= 400.

### 5.15 Trang không tìm thấy vẫn trả 200, nên phải đọc `<title>` chứ không đọc mã HTTP

Đối chiếu địa chỉ cũ với mặt tiền mới bằng mã HTTP cho kết quả **toàn 200**, kể cả
những địa chỉ hỏng hoàn toàn. Nguyên nhân là `cacheComponents`: vỏ trang đi ra kèm
mã 200 trước khi `notFound()` kịp chạy (xem 5.x về soft 404).

Thứ duy nhất phân biệt được là `<title>`. Một trang danh mục hỏng có tiêu đề
`Category Not Found` trong khi mã vẫn là 200 và trang vẫn vẽ ra bố cục bình thường.

**Cách kiểm đúng:**

```
curl -sS -L "$url" | grep -oE '<title>[^<]*'
```

Chuyện này còn nguy hơn ở chỗ: một bảng kiểm chỉ nhìn mã HTTP sẽ báo xanh cho toàn
bộ cây danh mục đã chết.

### 5.16 Giỏ hàng: ghi cookie vào response rồi đọc lại từ request

Lỗi nặng nhất trong ngày, và **mặt tiền trông hoàn hảo**.

```
const cart  = await getOrCreateCart(...)   // tạo giỏ, GHI cookie vào response
const token = await getCartToken(...)      // ĐỌC cookie từ request
```

Khách mới chưa có giỏ, nên request họ gửi đi **chưa hề có cookie**. Token về rỗng,
API trả `403 access_denied`, **lần thêm hàng đầu tiên của mọi khách đều hỏng**.

Nó sống sót lâu vì hai lớp che:

- chỉ hỏng **lần đầu**; sau đó cookie đã có nên thử lại là được
- lỗi ném ra có `message` **rỗng**, bộ bọc trả `error.message` nên hiện **một toast
  trống**, khách không đọc được chữ nào

**Cách đúng:** lấy token từ chính đối tượng vừa tạo, đừng đọc lại vòng qua cookie.
Và bộ bọc lỗi phải có câu dự phòng khi `message` rỗng, kèm ghi log.

**Chỉ bấm chuột thật mới thấy.** HTTP 200, HTML có đủ nút, thuộc tính đúng hết.

### 5.17 `spree_product_translations.slug` đè slug của sản phẩm ở 5.6, 5.4 thì không

Cùng một database, hai phiên bản đọc hai cột khác nhau:

| | đọc cột |
|---|---|
| 5.4 storefront | `spree_products.slug` |
| 5.6 Store API | slug trong bảng dịch |

Trên một shop, 14 trong 79 sản phẩm có slug bản dịch **khác** slug gốc, ví dụ
`2-0l` thành `2-dot-0l`. Những dòng đó **ghi ngày một năm trước** và **có sẵn trong
dump trước khi nâng cấp** — không ai đổi gì, cũng không phải bản nâng cấp sinh ra.

**Bài học nặng hơn phần kỹ thuật:** tôi đã kết luận "khách đổi tên sản phẩm sau ngày
dump" và nói ra. Khách phản đối, và khách đúng. **Trước khi nói dữ liệu thay đổi,
phải mở dump trước-nâng-cấp ra xem.**

Và một sai lầm đo đạc dẫn tới kết luận đó: tôi so `shop-specials/on-sale/combo-deals`
với `collections/combo-specials` rồi thấy slug khác nhau hoàn toàn. **Hai danh mục
khác nhau.** So sai đối tượng thì kết luận nào cũng sai.

### 5.18 Danh mục theo quy tắc trả 404, không phải trả rỗng

Bổ sung cho 5.10, đo chính xác:

| danh mục | `automatic` | `GET /categories/<permalink>` |
|---|---|---|
| có 19 sản phẩm | **t** | **404** |
| bên cạnh | f | 200 |

Nên danh mục automatic **không có địa chỉ** trên mặt tiền headless, chứ không phải
"có trang nhưng rỗng". Và trong admin 5.6, mở bảng thêm sản phẩm cho một taxon
automatic thì **văng 500**:

```
GET /admin/taxons/<permalink>/classifications/new  500
ActionController::UrlGenerationError   taxon_id: nil
```

Khách thấy ô tìm kiếm không trả gì và tưởng database hỏng.

### 5.19 `variants` không bao gồm variant gốc, mà giá lại nằm ở đó

```ruby
Spree::Product.joins(variants: :prices)                   # 0 sản phẩm
Spree::Product.joins(variants_including_master: :prices)  # 15 sản phẩm
```

Sản phẩm không có tuỳ chọn thì giá nằm trên **master variant**, và `variants` loại
nó ra. Truy vấn trả **rỗng**, mà rỗng đọc thành "không có hàng giảm giá" chứ không
đọc thành "truy vấn sai".

### 5.20 `generateSitemaps` làm `/sitemap.xml` trả 404, im lặng

Khai `generateSitemaps` trong `sitemap.ts` thì Next chuyển file thật sang
`/sitemap/{id}.xml` và **để `/sitemap.xml` trống**. Đó lại đúng là địa chỉ
`robots.txt` ghi và địa chỉ đã nộp cho Search Console.

Đặt route handler ngay tại `src/app/sitemap.xml` thì **build chết**:
`Conflicting route and metadata at /sitemap.xml`. Phải đặt tên khác rồi `rewrites()`
với `beforeFiles`.

Và `export const dynamic = "force-dynamic"` bị `cacheComponents` từ chối thẳng; thay
bằng `await connection()`.

### 5.21 Danh sách ghi cứng trong mã về dữ liệu của shop thì sẽ lệch

Bộ chính sách ghi cứng `shipping-policy` và `returns-policy`; shop thật có `shipping`
và `returns`. Kết quả: **hai link chết trong chân trang** và hai địa chỉ chết quảng
cáo trong sitemap. Không có lỗi nào, trang chỉ nói "không tìm thấy".

Slug chính sách là **dữ liệu của shop**, chủ shop đổi tên trong admin lúc nào cũng
được. Cái gì viết sẵn trong mã về database của người khác thì sẽ cũ.

### 5.22 Bộ quét rò rỉ chỉ đọc file git đã theo dõi

`git ls-files` không thấy file vừa viết xong chưa `git add` — mà **đó chính là lúc
cần kiểm**. Một rake task mới đi qua bộ quét sạch sẽ trong khi comment của nó chứa
slug sản phẩm của khách.

Mở rộng sang `git ls-files --others --exclude-standard` là bắt được ngay một file tạm
ở gốc repo mang tên miền khách, chỉ chờ `git add -A` là vào repo công khai.

### 5.23 Ghi lại vhost là xoá mất khối SSL certbot đã thêm

certbot **sửa tại chỗ** file vhost nó tìm thấy, thêm khối `listen 443 ssl` và trỏ
tới chứng chỉ. Script dựng lại file đó ở lần chạy sau là **xoá sạch phần HTTPS**,
nginx rơi về server mặc định, và mọi request tới tên đó thất bại xác thực chứng chỉ.

Triệu chứng hiện ra cách nguyên nhân **ba bước**: script tra id danh mục qua HTTPS,
curl không xác thực được nên trả rỗng, build nhận tham số rỗng, và kết quả là
**ba hàng sản phẩm rỗng trên trang chủ**. Không chỗ nào nhắc tới chứng chỉ.

**Hai chốt đi kèm:**

- không ghi đè vhost đã tồn tại, chỉ tạo khi chưa có
- kiểm chứng chỉ bằng cách **hỏi cổng 443** xem có khớp tên không, đừng chỉ nhìn
  file trong `/etc/letsencrypt` có tồn tại:

```
echo | openssl s_client -connect 127.0.0.1:443 -servername <host> \
  | openssl x509 -noout -checkhost <host>
```

Một file chứng chỉ chứng minh nó **từng được cấp**, không chứng minh nginx **đang
phục vụ nó cho tên đó hôm nay**.

### 5.24 Tham số build rỗng là kiểu hỏng im lặng nhất trong toàn bộ đường ống

`--build-arg NEXT_PUBLIC_CATEGORY_STANDOUTS=` (rỗng) thì build **thành công**,
image chạy, trang chủ mở được, và hàng sản phẩm đó **không render gì cả**. Không
lỗi, không cảnh báo, không dòng log nào.

Mọi lệnh dựng shop ở đây phải **chặn khi id trả về rỗng** thay vì truyền tiếp:

```
[[ -n "$standouts$combos$newprod" ]] || die "no collection ids came back"
```

### 5.25 Ghi chú của khách là MỆNH LỆNH, không phải lời mô tả

Note "No space" cạnh mũi tên chỉ vào khoảng trắng phía trên panel xanh được đọc
thành "ở đây không có khoảng cách" (một lời phàn nàn), nên đã **thêm** `mt-12`.
Kết quả: khoảng trắng **rộng ra**, và note quay lại lần thứ hai.

Cùng một lỗi, chỗ khác: "needs to be black and bigger font, it is getting lost"
được áp vào `<h1>` của trang, thứ **đã** đen và 36px. Hai mũi tên của ông ấy chỉ
vào `ORDERS, PAYMENTS & REFUNDS` và `SHIPPING & DELIVERY` — các heading nhóm,
đang là 14px `text-muted-foreground`. Sửa đúng chỗ đã đọc là không đổi gì cả.

**Chốt kiểm tra rẻ nhất:** nếu note yêu cầu một thuộc tính mà phần tử ta chọn
**đã có sẵn**, thì ta chọn sai phần tử. "Làm cho nó đen" chỉ có nghĩa khi nó chưa
đen.

### 5.26 Block render chữ thành string thuần thì KHÔNG thể mang định dạng

Ba block nhận copy của khách nhưng in `{body}` trực tiếp: `Notice`, `Subscribe`,
`AnnouncementBar`. Nghĩa là ba note của khách ("bold" ở câu cuối shipping notice,
"one good email at a time" phải đậm, và nửa sau dòng thông báo) **không thể** thực
hiện được: đánh dấu `**...**` vào file copy thì trang in ra chính dấu sao.

Nó không phải giả thuyết — phần FAQ từng lên production với dòng
"through **Stripe** and **PayPal**" đúng vì lý do này.

**Chốt:** mọi block nhận copy của khách phải đi qua `Inline`. Kiểm bằng cách grep
`Inline` trong từng file `components/blocks/*`, và kiểm text hiển thị (đã bỏ
`<script>`) không còn ký tự `*` nào.

### 5.27 Build trên server là build **bản source của server**

`script/shop_host storefront ca` build từ `/srv/_build/storefront`, và chỉ
`script/shop_host ship` mới đổ source lên đó. Sửa code ở máy rồi chạy thẳng
`storefront` thì:

- build **thành công**
- container khởi động, trang mở được
- và nó là **code cũ**

Giá đã trả: một vòng build trọn vẹn không đổi gì, rồi 19 trên 20 phép kiểm báo
FAIL trong khi code ở máy hoàn toàn đúng.

Vòng lặp nhanh cho front end (bỏ qua 8 phút build image Rails):

```
git ls-files storefront + CLIENT_ASSETS của storefront | tar | ssh 'tar -x -C /srv/_build'
script/shop_host storefront <shop>
```

Và luôn xác nhận file đã tới trước khi build:
`ssh 'grep -c <chuỗi vừa sửa> /srv/_build/storefront/<file>'`

### 5.28 Lỗi assertion của chính bộ kiểm đọc y như lỗi sản phẩm

Lần đo đầu tiên báo 5 FAIL. Cả 5 đều là lỗi của bộ kiểm, không phải của trang:

| báo FAIL | nguyên nhân thật |
|---|---|
| thanh thông báo không có màu | selector `body > div` bắt vào wrapper của framework |
| nút hàng không in hoa | object trả về khoá `transform`, assertion đọc `textTransform` |
| notice không phải xám | xám thật là `--muted #F1F0F0`, assertion ghi cứng `#F5F5F5` |
| subscribe không phải trắng | `oklch(1 0 0)` serialise thành `lab(100 0 0)` |

Nếu đem 5 dòng đó đi báo khách thì đó là 5 lời sai. **Trước khi kết luận sản phẩm
sai, phải chứng minh phép đo đúng.**

### 5.29 `clip` mà không có `fullPage` thì cắt theo VIEWPORT

Playwright screenshot với `clip` nằm dưới màn hình đầu tiên trả về ảnh rỗng, hoặc
ném thẳng `Clipped area is either empty or outside the resulting image`. Phải đi
kèm `fullPage: true`.

Liên quan: heading các hàng sản phẩm được in hoa bằng CSS (`uppercase`), nên
`textContent` là `Sustainable Standouts` chứ không phải `SUSTAINABLE STANDOUTS`.
Tìm phần tử theo chữ nhìn thấy trên ảnh thì không khớp.

### 5.30 Hai tên miền tạm bị đảo so với `.estate`

Tên miền tạm dạng `new<shop>` là **mặt tiền** (cổng storefront), tên miền dạng
`store.<shop>` là **Rails/admin** (cổng admin) — **ngược** với tên cột trong
`.estate`. Chính khách báo lại điều này, và `cmd_storefront` đã ghi đúng theo cách
đó, còn `cmd_web` thì không.

Hệ quả khi quên: mở tên miền `store.<shop>` để kiểm mặt tiền thì nhận 301 sang
`/admin` (header trả về có `x-runtime`, dấu hiệu của Rails), mọi phép grep trên
HTML trả rỗng, và kết luận rất dễ thành "bản build chưa lên" trong khi bản build
hoàn toàn ổn ở tên miền còn lại.

Cách kiểm không cần nhớ: so cổng trong vhost với `docker ps`, đừng suy từ tên.

### 5.31 Shop mở được, bán được, và **không có tấm ảnh sản phẩm nào**

Đo trên 5 shop, `active_storage_blobs` so với số file thật trong volume:

| shop | bản ghi ảnh | file thật |
|---|---|---|
| shop đã hoàn thiện | 622 | 764 |
| 4 shop còn lại | 232 / 267 / 258 / 258 | **1** mỗi shop |

Hai nguyên nhân **xếp chồng**, và mỗi cái một mình đã đủ làm hỏng:

1. **File chưa hề được mang sang.** Bản ghi có trong database, file thì không. Gọi
   URL blob trả `404` với `content-type: image/jpeg` và `0 byte` — trông như ảnh,
   không phải như lỗi.
2. **`spree_stores.url` trỏ vào host của mặt tiền, không phải host API.** Mà
   `images.remotePatterns` của Next chỉ cho phép host lấy từ `SPREE_API_URL`. Nên
   mọi ảnh sản phẩm nhận `400 "url" parameter is not allowed` từ
   `/_next/image` — **trước cả khi** chuyện thiếu file kịp có ý nghĩa.

Vì sao nó sống sót: **trang chủ không lấy ảnh từ shop.** Hero, About và logo đọc
từ `public/brand` nung trong image build, nên trang chủ đẹp nguyên. Bộ walk báo
"every image renders 5/5" ở shop hỏng và 27/27 ở shop tốt — cùng chữ "ok", khác
nhau ở con số mà không ai đọc.

Shop đó vẫn qua **25/27**, vẫn thêm được hàng vào giỏ.

**Phép kiểm một dòng, đáng chạy ngay sau mỗi lần restore:**

```
blobs=$(psql -At -d <db> -c "SELECT count(*) FROM active_storage_blobs")
files=$(docker exec <web> sh -c 'find /rails/storage -type f | wc -l')
[[ "$files" -ge "$blobs" ]] || die "$blobs bản ghi ảnh, chỉ $files file"
```

Và kiểm host của ảnh trên trang danh mục, không phải trang chủ:

```
curl -s <shop>/<c>/<locale>/c/collections/<x> | grep -o '_next/image?url=[^"]*'
```

Host trong tham số `url` phải khớp host của `SPREE_API_URL`. Khác là 400 toàn bộ.

### 5.32 Link markdown bị cắt qua hai phần tử mảng thì in ra nguyên dấu ngoặc

Copy các trang được kéo từ site thật của khách về. Một chỗ ngắt dòng **nằm bên
trong nhãn link** biến thành ngắt đoạn, nên một phần tử mảng kết thúc bằng

```
"Please visit our support portal: [https://help.example.com",
"](https://help.example.com)",
```

`Inline` chạy **theo từng phần tử**, nên không nửa nào khớp mẫu link, và cả hai
nửa in ra chính dấu ngoặc của nó cho khách hàng đọc.

Không có lỗi. Trang render, accordion mở ra bình thường, câu trả lời hiện
`[https://...](https://...)`.

**Có 4 chỗ như vậy, trên 2 shop.** Khách tìm ra **1** và gửi ảnh kèm chú thích
"FAQ last answer". Ba chỗ còn lại nằm trên những shop ông ấy chưa mở.

Đã thành gate: `script/check_copy_markup`, nằm trong `script/check_all`. Nó quét
mọi string copy tìm `[` chưa đóng, `](` mồ côi, và số `**` lẻ. Gate được thử
ngược lại bằng đúng 4 hình dạng lỗi thật cộng 5 dòng lành, trước khi tin nó.

### 5.33 Ghi chú của khách có thể bị chính khách đảo lại, và hai ghi chú có thể đánh nhau

Sáng 17 Aug ông ấy yêu cầu cột chữ hẹp lại còn 536px, và con số đó được ghi vào
code kèm lý do. **Tối cùng ngày ông ấy đảo lại:** "it will be easier to make them
bigger again and just leave them that size".

Cùng lúc đó hai ghi chú xung đột trực tiếp:

| ghi chú | thời điểm | yêu cầu |
|---|---|---|
| "No space" | sáng | ảnh phải sát biên trên, dưới, phải của panel |
| "the image needs to be down sized, it is way to big" | tối | ảnh phải nhỏ đi |

Sát biên + kéo cao bằng chiều cao chữ = ảnh 720x840. Không thể vừa sát biên vừa
nhỏ nếu chỉ sửa ảnh.

**Cách giải không phải thoả hiệp:** nới cột chữ ra (8/12 thay vì nửa trang) làm
chữ ngắn lại theo chiều dọc, panel thấp xuống, nên ảnh nhỏ đi ở **cả hai chiều**
mà vẫn sát cả ba biên. Đo được: 720x840 xuống 480x560, giảm 55% diện tích, ba
phép kiểm sát biên vẫn PASS.

Bài học: khi hai ghi chú đánh nhau, đừng chọn một cái. Tìm biến thứ ba mà cả hai
đều phụ thuộc vào.

### 5.34 Ảnh khách gửi WhatsApp nằm trong cache của app, và mtime khớp với từng tin nhắn

Khi không tải được ảnh từ chat, chúng vẫn có trên máy:

```
~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media/<chat>/
```

Tìm theo thời gian rồi đối chiếu với giờ của tin nhắn là ra ảnh nào thuộc câu nào:

```
find "$MEDIA" -newermt "2026-08-17 19:30" -iname "*.jpg" \
  -exec stat -f '%Sm %z %N' -t '%H:%M:%S' {} \;  | sort
```

5 ảnh tối đó khớp chính xác 5 mốc 19:57:59, 20:00:03, 20:01:49, 20:03:39 — nên
mỗi ảnh gắn được vào đúng câu ông ấy viết, thay vì phải đoán.

### 5.35 `fields` và `expand` là hai tham số khác nhau, kê tên quan hệ vào `fields` không có tác dụng gì

Thẻ sản phẩm trên trang chủ **không có ảnh thứ hai**, nên hiệu ứng hover im lặng
không làm gì, trong khi vẫn chạy hoàn hảo trên mọi trang danh mục. Khách báo đúng
như vậy: *"it works in the spree section but not on the front page"*.

Đo thẳng vào API đang chạy:

| request | `media` |
|---|---|
| `/products?limit=2` | **không có khoá `media`** |
| `/products?limit=2&fields=...,media` | **vẫn không có** |
| `/products?limit=2&expand=media` | có, 2 và 3 ảnh |

`fields` chỉ **thu hẹp cột**; `expand` mới là thứ **mang quan hệ về**. Kê `media`
trong `fields` là kê tên một thứ chưa hề được nạp.

Hai chỗ gọi cùng một danh sách `PRODUCT_CARD_FIELDS`, nhưng chỉ một chỗ có
`expand`:

```
ProductListing (trang danh mục)  fields + expand: ["media"]   → hover chạy
Collection     (trang chủ)       chỉ fields                    → hover chết
```

Không lỗi, không cảnh báo. Thẻ vẫn có `thumbnail_url` nên trông hoàn toàn bình
thường, chỉ là không có gì để đổi sang khi rê chuột.

**Phép kiểm:** đếm số `<img>` trong một thẻ sản phẩm, không phải kiểm thẻ có render
hay không. 22/22 thẻ có 2 ảnh là chạy; 0/22 là hỏng, mà trang trông y hệt nhau.

### 5.36 Một giá trị `sort_order` từ 5.4 nằm im trong 5.6 cho tới khi có ai đó lưu dòng đó

Chuyển `collections/on-sale` sang manual trên 4 shop: 3 shop chạy, **au thất bại**,
và thất bại **im lặng giữa một vòng lặp** vì log của ActiveJob đẩy dòng lỗi ra khỏi
màn hình. Chỉ đến khi đếm lại trạng thái từng shop mới thấy au vẫn `automatic=true`.

Nguyên nhân:

```
Sort Order is not included in the list
sort_order = "newest-first"
5.6 chấp nhận: manual, best_selling, price asc, price desc,
               available_on desc, available_on asc, name asc, name desc
```

`newest-first` và `price-low-to-high` là cách viết của 5.4. 5.6 **không migrate**
chúng, và validator chỉ chạy **khi lưu**. Nên dòng đó ngồi yên trong database hợp
lệ về mặt đọc, và **quả mìn nổ vào tay người đầu tiên bấm Save trong admin** — ở
đây là khách, không phải chúng ta.

Quét cả 5 shop: 2 dòng, trên 2 shop khác nhau, mỗi shop 1 dòng. 3 shop còn lại
sạch. Giá trị đúng không phải đoán: cùng taxon đó trên 3 shop lành đều là
`"manual"`, và 76 taxon khác trên chính shop au cũng là `"manual"`.

**Bài học về quy trình, nặng hơn bài học kỹ thuật:** một vòng lặp `for shop in ...`
in kết quả ra màn hình thì shop hỏng ở giữa sẽ bị cuộn mất. Sau mỗi thao tác hàng
loạt phải **đọc lại trạng thái từng shop bằng một truy vấn riêng**, chứ không đọc
output của chính thao tác đó.

### 5.37 Một shop không có nội dung riêng thì **phục vụ nội dung của shop khác**, đầy đủ và thuyết phục

`HOME_BY_SHOP[shop] ?? HOME_BY_SHOP.nz`

Dấu `??` là toàn bộ vấn đề. Bản đồ nội dung chỉ có **2 trong 5 shop**. Ba shop còn
lại không lỗi, không cảnh báo, không render trang trắng — chúng render **trang của
New Zealand**, trọn vẹn: hero, About, và **thông báo vận chuyển**.

Cái nguy hiểm nhất là thông báo vận chuyển: shop **Mỹ** nói với khách Mỹ rằng
**G.S.T của họ đã được trả trước**. G.S.T không tồn tại ở đó.

Ba shop đó vẫn qua **27/27** e2e, vẫn bán được, vẫn trông như đã xong. **Khách tự
tìm ra**, không phải bộ kiểm nào: *"please check the front page hero section text
on the new shops compare to the current shops"*.

Đã thành gate: `script/check_shop_content`, đọc danh sách shop từ file estate rồi
đối chiếu với 6 bản đồ nội dung. Thêm shop thứ 6 vào estate là gate đỏ cho tới khi
shop đó có chữ của chính nó.

**Phép kiểm rẻ nhất khi nghi ngờ:** lấy fingerprint text trang chủ từng shop rồi so
hash. Hai shop trùng hash là một shop đang mượn chữ của shop kia.

### 5.38 Chuỗi kéo từ site thật mang theo `**`, và **heading không đi qua bộ định dạng**

Sau khi vá 5.37, ba shop hiện ra hero dạng: `Welcome to **<brand>** – Bottles with...`

Copy kéo từ trang thật của khách có `**<brand>**` vì trên trang đó chữ ấy đậm. Mọi
đoạn văn đều đi qua `Inline`, **riêng `heading` thì không**:

```jsx
<h2 className="text-3xl font-bold mb-4">{heading}</h2>   // in ra nguyên dấu **
```

`check_copy_markup` **không bắt được**, vì cặp `**` này **cân bằng** — nó hợp lệ,
chỉ là được render ở chỗ không biết dịch nó.

Hai chốt đã thêm:
- `heading` đi qua `Inline` như mọi chuỗi khác
- bộ walk e2e đếm `**` trên **trang chủ**, trước đó chỉ đếm trên các trang nội dung

### 5.39 11 mẫu email đã port, chưa mẫu nào từng được **dựng thử**

Khách hỏi: *"does the reimbursement email work or not? I can't remember"* — và không
ai trả lời được, vì chưa có gì từng gọi mailer. Các mẫu được kiểm bằng mắt so với
bản thiết kế; việc mailer có **ghép nổi** chúng với dữ liệu thật của shop thì chưa.

Lần chạy đầu tiên của `bin/rails emails:smoke` trả lời luôn, và tìm ra **2 lỗi**:

| lỗi | phạm vi |
|---|---|
| `DelegationError: store delegated to order, but order is nil` | 4/5 shop, do **một dòng reimbursement mồ côi** |
| `missing interpolation argument :shop_url` | **chỉ Canada**, và là **mọi khách đăng ký mới** |

Dòng mồ côi **không phải do migrate**: mở dump 13/8 của chính khách ra, nó trỏ tới
`order_id 38` và `customer_return_id 1`, trong khi bảng customer returns **rỗng** và
order id trong dump **bắt đầu từ 92**. Hỏng sẵn từ trước. (§5.17 lần nữa: mở dump
trước khi nói dữ liệu thay đổi.)

Lỗi Canada thì là của chúng ta: file ngôn ngữ của khách dùng `%{shop_url}` trong câu
chào, partial không truyền tham số đó, và I18n **raise** chứ không bỏ qua. Chỉ Canada
đỏ vì chỉ Canada có file ghi đè khoá đó.

**Bài học:** "mẫu render đẹp" và "mailer dựng được mẫu đó với dữ liệu shop" là **hai
tuyên bố khác nhau**. Cái thứ hai chưa ai đo cho tới hôm nay.

### 5.40 `RAILS_HOST` không đặt → mọi URL Rails dựng ngoài request trỏ vào **mặt tiền**, nơi không có `/rails`

Logo trong email Canada là **ảnh vỡ**. URL của nó:

```
https://<storefront-host>/rails/active_storage/representations/proxy/...  → 404
```

`<storefront-host>` là tên miền của Next, không phải của Rails. Rails không phục vụ
`/rails/active_storage` ở đó.

Chuỗi nguyên nhân, và không chỗ nào nhắc tới email:

```
script/shop_host ghi  STORE_URL=$S_DOMAIN   (S_DOMAIN = tên miền MẶT TIỀN)
RAILS_HOST không được ghi
→ routes.default_url_options = {}
→ Active Storage rơi về host lấy từ STORE_URL
→ logo email trỏ vào mặt tiền → 404
```

`config/environments/production.rb` đã ghi sẵn `RAILS_HOST` là biến chuẩn cho đúng
việc này, chỉ là chưa ai đặt nó. Đặt `RAILS_HOST=$S_STORE` (host của Rails) là mọi
URL ảnh trong 34 email của 5 shop trả **200**.

**Đáng nhớ:** một shop có **hai** tên miền, và biến nào dùng tên nào là chuyện phải
đo. `STORE_URL` nghe như "địa chỉ của shop" nhưng thứ Rails cần là "địa chỉ Rails
trả lời".

### 5.41 List trong email thừa hưởng `text-align:center`, dấu chấm nằm lại bên trái

Partial hero dùng chung của Spree canh giữa nội dung. `<ul>` bên trong thừa hưởng,
nên **chữ chạy vào giữa** còn **dấu chấm đứng nguyên ở mép trái** (vì
`list-style-position: outside`). Đo được:

```
ulTextAlign  = "-webkit-center"
ulLeft = 170,  liLeft = 190      // chấm ở 170, chữ bắt đầu ở 190 rồi canh giữa
```

Nhìn ra là một hàng chấm bơ vơ bên trái đoạn chữ canh giữa. Sửa: `text-align:left`
**inline** trên cả `<ul>` lẫn `<li>` — email không có stylesheet để dựa, và một số
client bỏ qua thuộc tính kế thừa trên list item.

**Bài học chung với 5.39:** email chỉ có thể kiểm bằng cách **dựng ra rồi nhìn**.
Cả hai lỗi này đều đi qua `emails:smoke` màu xanh, vì smoke test hỏi "có dựng được
không", không hỏi "trông có đúng không".

### 5.42 Hai cột nhãn và giá trị canh nhau **bằng mắt**, một giá trị rỗng làm lệch cả khối

Khách báo: *"you need to fix some fields so the data stays in the right place"*, kèm
ảnh cho thấy `Payment #: <địa chỉ shop>` — tức là giá trị của trường **Shop**.

Khối thông tin đơn hàng là **hai `<td>` độc lập**: 6 thẻ `<p>` nhãn ở ô trái, 6 thẻ
`<p>` giá trị ở ô phải. Chúng thẳng hàng chỉ vì **tình cờ** cùng số dòng và cùng
chiều cao. Đơn không có bản ghi payment thì 2 giá trị render ra `<p>` **rỗng**, mà
`<p>` rỗng **cao 0 pixel**.

Đo trên đơn thật:

```
nhãn     y = 391  413  436  458  480  519
giá trị  y = 391  413  436  436  436  474
                       ^^^  ^^^ hai cái rỗng, cao 0
```

Nên "Payment #" (y=436) nằm cạnh **địa chỉ shop** (cũng y=436), còn "Shipping from"
(y=519) không có gì bên cạnh.

Sửa: **mỗi trường một `<tr>`**, nhãn và giá trị cùng một hàng. Một hàng không thể
lệch khỏi chính nó. Trường rỗng thì bỏ hẳn hàng đó thay vì để hàng trống.

**Nguyên tắc:** trong email, đừng bao giờ canh hai cột bằng cách trông cậy số phần
tử bằng nhau. Bảng có hàng thật thì rỗng hay không cũng không lệch.

### 5.43 Bốn shop gửi email mang thương hiệu của **shop thứ sáu**

Cùng một hình dạng lỗi với §5.37, lần này ở email. Mọi mẫu đọc logo và tên shop từ
khoá ngôn ngữ:

```
Spree.t(:shop_logo,  scope: [:user_emails, :common])
Spree.t(:shop_url,   scope: [:user_emails, :common])
```

Chỉ **một** shop có file ngôn ngữ riêng (`en-CA`). Bốn shop còn lại rơi về `en` mặc
định, mà `en` lại do file của **thương hiệu B2B** định nghĩa. Kết quả đo được trên
mail đã render:

| shop | logo trong email |
|---|---|
| shop có file riêng | logo của chính nó |
| 4 shop còn lại | **logo của thương hiệu khác** |

Và trong phần chân thư: *"Thank you for choosing <thương hiệu khác>"*, *"The
<thương hiệu khác> Team"*, *"Trusted by Businesses Since 2005"*.

Phần **sửa được không cần hỏi**: logo và địa chỉ shop lấy từ **bản ghi store** chứ
không từ file ngôn ngữ — mỗi shop đã có `mailer_logo` do chính chủ upload, và địa
chỉ công khai nằm trong `spree_custom_domains`. Không thể là của shop khác.

Phần **phải hỏi**: câu chữ. Đó là lời của khách, không phải dữ liệu suy ra được.

**Một bẫy phụ trong lúc sửa:** `url_for(attachment)` **raise** trong ngữ cảnh mailer,
và `rescue` quanh nó biến lỗi thành **im lặng rơi về logo sai** — đúng cái lỗi đang
đi sửa. Phải dùng partial `spree/shared/mailer_logo` mà chính Spree dùng.

### 5.44 `git ls-files` bỏ sót file mới — **ba lần trong một buổi chiều**

`script/shop_host ship` dựng danh sách file từ `git ls-files`. File chưa `git add`
thì **không lên server**. Build thành công, image bình thường, ứng dụng thiếu file.

| file mới | triệu chứng |
|---|---|
| controller | route trả 500, `uninitialized constant` |
| view partial | mọi email đơn hàng raise `Missing partial` |
| helper | cùng hình dạng, bắt được trước khi ship |

Mỗi lần code đều đúng, phép kiểm đều đúng, chỉ là file không có ở đó. Mỗi lần cách
sửa đều là `git add`.

Cùng cái bẫy với bộ quét rò rỉ ở §5.22: nó chỉ đọc file git đã theo dõi, nên không
thấy đúng file nguy hiểm nhất là file vừa viết xong. Giờ đã có gate:
`script/check_untracked_source`.

### 5.45 `config/locales` được Rails glob **đệ quy**, thư mục con không phải là cách ly

Tiếp §5.43. Cách sửa là cho mỗi shop một file câu chữ riêng, rồi chỉ nạp đúng file
của shop đó. Lần đầu đặt ở `config/locales/shops/<shop>.en.yml`, tin rằng Rails chỉ
glob một tầng. **Không phải.** `Rails::Engine` khai:

```ruby
paths.add "config/locales", glob: "**/*.{rb,yml}"
```

Đo trên container Úc đang chạy, `I18n.load_path` có `shops/au.en.yml` **bất kể**
`SHOP` bằng gì. Nghĩa là file của mọi shop nằm trên load path của mọi shop. Hai shop
cùng viết dưới root `en` (us và nolocal) thì đè nhau, và đây không phải chuyện gọn
gàng: đó là shop này gửi câu chữ của shop kia.

Chỗ đúng là **ngoài** `config/locales`, ở `config/shop_locales/`, nơi Rails không có
lý do gì để nhìn vào.

**Bẫy thứ hai, ngay sau đó.** Append vào `I18n.load_path` ở thân một initializer thì
file rơi xuống **đầu** danh sách, tức là **thấp ưu tiên nhất**, ngược hoàn toàn với
ý định. Vì mỗi engine tự thêm locale của nó bằng:

```ruby
initializer :add_locales do
  config.i18n.load_path.unshift(*paths["config/locales"].existent)
end
```

`config/initializers/*` chạy **trước**, rồi `add_locales` **unshift** đè lên trước
nó. Đo được: file của shop đứng thứ 0 trên 9. Sau khi chuyển sang
`config.after_initialize`, nó đứng thứ 9 trên 9, và `I18n.backend.reload!` là bắt
buộc vì backend đã đọc load path trong lúc boot.

Cả hai lần đều "nhìn thì đúng" và chỉ có phép đo mới nói khác.

### 5.46 `%{...}` không điền thì **in nguyên ra cho khách**, I18n không raise

Kéo file `en.yml` của 5 shop từ server cũ về, mỗi shop một file như chính chủ nói.
Hai trong năm file có:

```yaml
order_confirm:
  order_number: "Order # %{number}"     # us, nolocal
  order_number: "Order/Invoice #:"      # ca, au, nz
```

Cùng một khoá, hai hình dạng khác nhau, vì mỗi shop viết file cho mẫu email của
riêng nó. Mẫu ở đây dùng khoá này làm **nhãn** của một hàng, và không truyền
`number:`.

Kết quả **không** phải một exception. Mail dựng thành công, subject đúng, và trong
thân thư khách đọc được đúng tám ký tự `%{number}` nằm cạnh số đơn thật.

Gate nằm ở `emails:smoke`: quét thân thư đã render tìm `%\{[a-z_]+\}`. Kiểm trên
**thân thư** chứ không trên file ngôn ngữ, vì thân thư là thứ khách đọc và không cần
biết placeholder đến từ mẫu nào trong mười một mẫu. Bật thử lại giá trị cũ: 3 trong
6 mẫu fail ngay.

### 5.47 Bốn shop gửi email bảo khách viết thư cho **support của nước khác**

Đo A/B trên từng container, trước và sau khi nạp file riêng của shop:

| shop | trước | sau |
|---|---|---|
| au | địa chỉ support của **Canada** | support của chính nó |
| nz | địa chỉ support của **Canada** | support của chính nó |
| us | địa chỉ support của **Canada** | support của chính nó |
| nolocal | địa chỉ support của **Canada** | support của chính nó |

Không chép địa chỉ thật vào đây: repo này công khai. Bản đo đầy đủ nằm ở
`tmp/client/proof-wording-2026-08-18/`, thư mục đã gitignore.

Kèm theo đó là kho hàng và thời gian giao của Canada dán vào thư báo gửi hàng của cả
bốn shop. Không phải "sai thương hiệu" ở phần chân thư như §5.43 mô tả, mà là **địa
chỉ liên hệ sai quốc gia** ở giữa thư — thứ khách hàng thật sự bấm vào.

File câu chữ đúng của từng shop nằm sẵn trên server cũ, ở
`/home/eshop/<ver>/www/<shop>/config/locales/en.yml`, đúng như chủ shop nói. Kéo về
đo được 24 khoá khác nhau giữa 5 shop: lời chào (`Kia ora` cho NZ, `Hiya` cho AU),
email hỗ trợ, tiền tệ, kho hàng, tiêu đề thư chào mừng.

## 6. Còn treo

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

### 5.48 Bịt rò rỉ ở khoá shop CÓ, còn 50 khoá shop KHÔNG có thì vẫn chảy

§5.47 cho mỗi shop một file riêng và nạp cuối cùng, nên file shop thắng. Nhưng nó
chỉ thắng ở **những khoá shop có viết**. File của thương hiệu thứ sáu vẫn nằm trong
`config/locales`, tức thư mục mọi container đều đọc, và tiếp tục cấp **50 khoá** mà
không shop bán lẻ nào định nghĩa:

| khoá | nội dung chảy sang cả 5 shop |
|---|---|
| `payment_link.account_name` / `bank_name` / `account_number` / `swift_code` | khối ngân hàng của một **công ty khác** |
| `common.contact_url` | trỏ về site của thương hiệu khác |
| `welcome.heading` | `Your Account Is Awaiting Final Approval` |
| `common.slogan` | khẩu hiệu của thương hiệu khác |
| toàn bộ `account_approval.*` | luồng duyệt tài khoản bán sỉ |

Xác nhận trên **mail đã render**, không suy từ file:

```
payment link contains Guardian   YES
payment link contains HSBC       YES
payment link contains SWIFT      YES
```

Bài học: fallback vô hình đúng ở chỗ **không ai viết gì**, mà đó cũng là chỗ không
ai nghĩ tới để nhìn. Gate mới `check_shop_locales` từ chối bất kỳ tên thương hiệu
nào trong `config/locales`, và tên đó **đọc từ `.estate`** chứ không ghi cứng, vì
lần đầu viết gate đã bị chính bộ quét rò rỉ bắt.

### 5.49 Hai file của cùng một khách dùng hai bộ từ khoá cho cùng một vai trò

Cùng chủ, cùng ngôn ngữ, khác vựng từ:

| vai trò | file commercial | file bán lẻ |
|---|---|---|
| heading | `heading` | `welcome_message` |
| lời chào | `greeting` | `welcome_customer` |
| dẫn nhập | *(không có)* | `welcome_family` |
| lý do mua | *(không có)* | `why_shop_title` + `why_shop_bullets` |

Mailer quyết định "shop này có copy riêng chưa" bằng `Spree.t(:heading, ...)`. Mọi
shop bán lẻ **trượt bài kiểm đó**, và chỉ vì file commercial nằm cạnh nên chúng vay
được heading của nó rồi gửi `Your Account Is Awaiting Final Approval` cho khách bán
lẻ không hề có bước duyệt.

Chiều ngược lại: **5 khoá ổng viết cho bán lẻ chưa từng được đọc bởi bất cứ thứ gì.**
`Why you'll love shopping with us` và 4 bullet của nó chưa từng xuất hiện trong bất
kỳ email nào, trên bất kỳ shop nào.

Đọc được file của khách không có nghĩa là đọc được **vựng từ** của khách. Template
phải nhận cả hai bộ tên, và phải kiểm bằng cách render ra rồi đọc, không phải bằng
cách đối chiếu khoá.

### 5.50 `with_store_locale` chỉ bọc `mail()`, mọi QUYẾT ĐỊNH ở ngoài nó

Sau §5.48, email chào mừng của ca/au/nz rơi về wording chung còn us/nolocal thì
đúng. Mẫu khớp tuyệt đối với root của file: shop dùng root vùng thì trượt, shop
dùng `en` thuần thì trúng.

`Spree::BaseMailer#with_store_locale(store)` đã có trong `welcome_email` — nhưng
chỉ bọc quanh `mail(...)`, tức chỉ lúc render thân thư. Ba thứ chạy **trước** nó:

```ruby
his_copy = Spree.t(:heading, ...)   # ở locale mặc định
subject  = Spree.t(:subject, ...)   # ở locale mặc định
with_store_locale(store) do         # tới đây mới đổi
  mail(...)
end
```

Đo trên Canada:

```
store.default_locale       en-CA
I18n.locale trong mailer   en
welcome_message at en      (absent)
welcome_message at en-CA   <tiêu đề chào mừng của chính shop>
```

`his_copy` thành false, `@copy_scope` thành nil, shop gửi wording chung trong khi
chữ của khách nằm cách đó đúng một locale. Thân thư thì render ở en-CA, nên nhìn
vào code thấy "đã có with_store_locale" là yên tâm.

`deliver_outcome` nặng hơn: `return if Spree.t(:heading, ...).blank?` cũng ở ngoài
wrapper, nên email duyệt tài khoản **im lặng không gửi** với mọi shop root vùng.

Bọc cả thân hàm vào `with_store_locale`. Dùng helper của Spree chứ không
`I18n.with_locale`, vì helper còn đặt `Mobility.store_based_fallbacks`.

Kết quả, locale để nguyên `en` đúng như đường chạy thật: 421 → **1226 ký tự**.

### 5.51 Probe tự set điều kiện thuận lợi rồi báo đạt

Lỗi trên được báo là "đã sửa xong" một lần, dựa trên script probe mở đầu bằng:

```ruby
I18n.locale = Spree::Store.default.default_locale
```

Dòng đó làm probe **không còn tái hiện đường chạy thật**, và nó chính là biến duy
nhất đang hỏng. Phép đo đúng, kết luận sai, y hệt §5.28.

Quy tắc rút ra: một probe cho mailer **không được set `I18n.locale`**. Cái gì mailer
tự lo thì probe phải để nguyên, vì đó thường là cái đang hỏng.

### 5.52 Chữ của page builder nằm ở Action Text, không nằm ở `preferences`

Tra `spree_page_blocks.preferences` thấy không có chữ nào, kết luận "khách chưa viết".
Sai. Block chỉ giữ **thiết lập** trong `preferences`; chữ nằm ở
`action_text_rich_texts`, khoá theo `record_type='Spree::PageBlock'` + `record_id`.

```
spree_page_blocks.preferences   :text_alignment: left, :size: large, :top_padding: 24
action_text_rich_texts.body     <div>Welcome to Your Wholesale Portal</div>
```

Đếm lại đúng bảng: b2b có **517 dòng**, trong đó 55 của `Spree::PageBlock`. Không
mất gì.

**Sai lần hai, ngay sau đó.** Thấy `preferences` rỗng mà dump của khách có chuỗi
đó, suýt kết luận **migrate làm mất dữ liệu**, đúng cái sai của §5.17. Thứ chặn
được là quy tắc mở dump trước — nhưng lần này còn phải đếm lại trong DB mới bằng
**đúng bảng**, vì "không có ở chỗ tôi tra" và "không có" là hai câu khác nhau.

Cùng hình dạng đã xảy ra ba lần trong hai ngày:

| tra ở đâu | kết luận sai | sự thật |
|---|---|---|
| `spree_taxon_translations` | taxon 44/46 không tồn tại | bảng đó rỗng, tên nằm ở `spree_taxons.name` |
| `spree_page_blocks.preferences` | khách chưa viết chữ | chữ ở `action_text_rich_texts` |
| probe tự set `I18n.locale` | mailer đã sửa xong | probe che mất đúng biến đang hỏng |

Quy tắc rút ra: trước khi nói "không có", phải trả lời được **"nó thì nằm ở đâu"**.
Một truy vấn trả về rỗng chỉ chứng minh về truy vấn đó, không chứng minh về dữ liệu.

### 5.53 `ssh -n` sửa được một lỗi câm và tạo ra một lỗi câm khác

Sáng 18 Aug, một vòng lặp đọc `.estate` in đúng **1 dòng trên 12** rồi thoát 0.
Nguyên nhân: `ssh` bên trong `while read` nuốt sạch stdin của vòng lặp. Bản vá là
`ssh -n`, tức là nối `/dev/null` vào stdin. Đúng, và đã thành thói quen trong mọi
hàm ssh của repo này.

Chiều cùng ngày, dùng chính hàm đó để đẩy file wording đã sửa lên container:

```bash
cat config/shop_locales/b2b.en.yml | sh_ "cat > /tmp/b2b.yml && docker cp /tmp/b2b.yml b2b_web:/rails/..."
```

`sh_` có `-n`. Nên `cat` ở đầu kia đọc `/dev/null`, ghi ra file **0 byte**, rồi
`docker cp` chép cái rỗng đó **đè lên toàn bộ từ vựng email của shop**.

Không có gì báo lỗi. `cat` thoát 0, `docker cp` thoát 0, container vẫn chạy. Lỗi
chỉ lộ ra ở lần dựng email kế tiếp, và lộ ra dưới một cái tên chẳng liên quan gì
đến việc chép file:

```
I18n::InvalidLocaleData: can not load translations from
  /rails/config/shop_locales/b2b.en.yml: expects it to return a hash, but does not
```

Ba điều rút ra:

**Một bản vá cũng là một thay đổi hành vi.** `-n` không phải "cho an toàn". Nó
đóng stdin. Ở nơi cần stdin thì nó phá. Hàm ssh dùng chung phải tách làm hai:
một cái để chạy lệnh (`-n`), một cái để đẩy nội dung (không `-n`).

**`docker cp` là ghi đè, và ghi đè bằng rỗng vẫn là ghi đè thành công.** Không có
cảnh báo cho "bạn vừa thay một file 11.696 byte bằng một file 0 byte".

**Cổng đọc repo không thấy được cái đang chạy.** `check_shop_locales` đọc thư mục
này, nơi file vẫn hoàn hảo, nên nó vẫn xanh trong khi shop đang chạy với con số
không. Đó là lý do có `check_locale_drift`: nó hỏi thẳng container đang giữ cái gì,
so sha256, và đã được thêm vào `check_all`.

Cách chép đúng, đối chiếu ở cả ba chặng:

```
máy mình  : 42089bc2d152ffc1  (11696 byte)
trên server: 42089bc2d152ffc1  (11696 byte)
trong cont : 42089bc2d152ffc1
```

Quét lại toàn bộ 6 shop đang chạy sau khi phát hiện: cả 6 đều khớp repo. Chỉ b2b
bị, vì chỉ b2b được chép theo kiểu đó.

### 5.54 File wording của cùng một shop **tự mâu thuẫn với chính nó**

`b2b.en.yml` khách gửi sang, cùng một file:

```yaml
dòng 121:  ctry_dollar: "NZ$"       ← định nghĩa
dòng 122:  ctry_currency: "NZD"     ← định nghĩa
dòng 139:  ... %{nz_dollar} ...     ← dùng tên khác
dòng 148:  TOTAL CANCELLED (%{nz_currency})
```

Nó **định nghĩa** đúng bộ tên chung mà template cấp, rồi **dùng** một bộ tên khác
mà không ai cấp. Đây là lỗi thứ ba cùng dạng trong một ngày, trên tài liệu do
khách soạn:

| lỗi | cách nó lộ ra |
|---|---|
| `order_number: "Order # %{number}"` | in chữ `%{number}` ra cho khách đọc |
| `shop_URL_full` viết hoa | placeholder không điền được |
| `%{nz_dollar}` / `%{nz_currency}` | **raise**, email huỷ đơn không dựng nổi |

Cái thứ ba nặng nhất vì nó ném lỗi chứ không in sai: theo §5.46, một `%{...}`
không điền được thì in nguyên ra, **nhưng chỉ khi không có tham số nào khác**.
Có tham số khác là `MissingInterpolationArgument`. Email huỷ đơn có tham số khác,
nên nó chết hẳn.

Chỉ có dựng thật cả 6 email mới thấy. Đọc file YAML không thấy, vì từng dòng một
đều hợp lệ; cái sai nằm giữa hai dòng cách nhau 20 dòng.

### 5.55 `while read` bỏ dòng cuối khi file không kết thúc bằng newline

Danh sách 16 file cần phục hồi được sinh bằng Python:

```python
io.open('todo.txt','w').write('\n'.join(out))    # không có newline cuối
```

rồi đọc bằng `while IFS='|' read -r ... done < todo.txt`. `read` trả về false khi
gặp EOF mà chưa thấy newline, **kể cả khi đã đọc được nội dung vào biến**. Nên vòng
lặp xử lý 15 dòng, thoát 0, và in "✓ chép đúng checksum: 15 ✗ lỗi: 0".

Báo cáo đó hoàn toàn đúng về những gì nó làm, và hoàn toàn im lặng về cái nó không
làm. File thứ 16 (`kooler-2000-side.jpg`) không được chép và không có dòng nào nói
vậy.

Chỉ lộ ra vì đã biết trước con số phải là 16. Đây là lý do mọi vòng lặp hàng loạt ở
đây phải in **số đầu vào và số đầu ra**, không phải chỉ số thành công:

```
   số dòng todo.txt: 15 (wc đếm theo newline)  thực có: 16
```

`wc -l` cũng đếm theo newline nên nó nói dối theo đúng cùng một kiểu. Cách đếm đúng
là `grep -c .`.

Cùng họ với §5.53: một lệnh thoát 0 sau khi làm ít hơn yêu cầu.

### 5.56 `Spree::Product.count` và `unscoped.count` lệch nhau, và cái lệch đó trông y hệt mất dữ liệu

Khi dựng container b2b, một probe in ra 47 sản phẩm. Bốn tiếng sau, trước khi chạy
một tác vụ có ghi dữ liệu, ảnh chụp in ra 42. Năm sản phẩm biến mất giữa hai lần đo,
trên database của khách, trong lúc khách vẫn đang tự sửa nó.

Đo cho ra:

```
scoped:   42
unscoped: 47
deleted:   5
sửa gần nhất: 2026-08-13 08:37 UTC
```

Không mất gì. `Spree::Product` xoá mềm, và scope mặc định bỏ qua `deleted_at`.
Probe đầu đếm không scope, probe sau đếm có scope. Cùng một dữ liệu, hai phép đếm.
Và bản ghi sửa gần nhất có từ sáu ngày trước, tức là trước cả khi động vào shop này.

Đây đúng là lỗi mà `CLAUDE.md` đã ghi từ 17 Aug: so hai phạm vi khác nhau rồi kết
luận dữ liệu đã bị sửa, và suýt nữa nói với khách như vậy lần thứ hai.

Hai quy tắc rút ra:

**Một ảnh chụp phải nói rõ nó đếm cái gì.** `42` không phải là một con số, `scoped
42 / unscoped 47 / deleted 5` mới là. Ảnh chụp trước và sau chỉ so được với nhau khi
cả hai dùng cùng một định nghĩa, và định nghĩa đó phải nằm ngay trong kết quả.

**Trước khi báo động, hỏi "cái chênh này có sẵn tên gọi không".** `updated_at` gần
nhất trả lời câu đó trong một dòng: nếu bản ghi mới nhất cũ hơn thời điểm mình bắt
đầu, thì không phải mình, và cũng không phải hôm nay.

### 5.57 `cacheComponents` biến `generateStaticParams` rỗng thành lỗi build, và đó là điều duy nhất bắt được bản build cũ

Build storefront cho shop bán sỉ chết ở:

```
[EmptyGenerateStaticParamsError]: When using Cache Components, all
`generateStaticParams` functions must return at least one result.
Failed to collect page data for /[country]/[locale]/pages/[slug]
```

Đọc thẳng thì tưởng shop đó không có trang nội dung nào. Thực tế nó có ba, và
`PAGES_BY_SHOP` ở máy này có đủ. Cái sai nằm ở chỗ khác hẳn: **build chạy trên
server, từ `/srv/_build`, và thư mục đó chưa bao giờ được `cmd_storefront` làm
mới.** Chỉ `cmd_ship` ghi vào đó. Nên bản `content.ts` trên server là bản của hôm
trước:

```
content.ts ở máy này : 9745a504…   7 mục shop
content.ts trên server: afd16214…   2 mục shop
```

`content.ts` là file gitignored, nên nó chỉ tới server qua đúng một đường: cái
tar trong `cmd_ship`. Build storefront không đi qua đường đó.

Điều đáng ghi là **vì sao mình phát hiện được**: hoàn toàn nhờ may. Shop bán sỉ
chưa có mục nào trong bản cũ, nên danh sách trả về rỗng, và `cacheComponents` từ
chối danh sách rỗng. Nếu bản cũ chỉ *lỗi thời* chứ không *thiếu hẳn*, build đã
chạy xong và phục vụ chữ của tuần trước, không một dòng cảnh báo.

Quy tắc: **một bước build không tự sở hữu mã nguồn của nó là một bước build sẽ có
ngày biên dịch thứ không ai chọn.** `cmd_storefront` giờ tự đẩy mã lên và **so
sha256 từng file gitignored** thay vì chỉ kiểm tra file có tồn tại: cái hỏng ở đây
là một file *có mặt và cũ*, mà `test -f` gọi là đạt.

---

### 5.58 `sed` thoát 0 khi không khớp gì, nên "đã sửa" và "không tìm thấy chỗ để sửa" là cùng một mã thoát

`script/shop_host public <shop>` chèn dòng `include` vào vhost bằng:

```bash
grep -q 'nginx-public.conf' $vhost || sed -i 's|^\(\s*server_name $DOMAIN;\)|\1\n    include ...|' $vhost
```

Shop nz phục vụ **404 cho `llms.txt` của chính nó suốt ba ngày**, trong khi file
nằm sẵn trên đĩa, 7974 bytes, và `nginx-public.conf` giống hệt từng byte với bốn
shop chạy được. Đo mới ra: trong 9 vhost, đúng `newnz` và `newb2b` không có dòng
`include`; năm cái kia có.

`sed` không coi "không khớp mẫu nào" là lỗi. Nó thoát 0 y như khi thay thành công.
Nên câu lệnh trên **không thể phân biệt** giữa đã chèn được và không có dòng nào
để chèn vào. Không có gì kêu, và bước kiểm bằng `curl` ngay sau đó chỉ chạy cho
các file `[[ -f "$src/$f" ]]`, nên nó chết sau khi đã upload xong file, để lại đúng
trạng thái nửa vời: **file có, cấu hình phục vụ file đó thì không**.

Đây là bản sao của cùng một hình đã gặp ở `while read` (§5.55) và ở `test -f`
(§5.57): một công cụ trả về "ổn" cho hai trạng thái khác hẳn nhau.

Quy tắc: **sau khi sửa một file bằng `sed`, hỏi lại file đó.** Không hỏi `sed`.

```bash
rsh "grep -q 'nginx-public.conf' $vhost" \
  || die "could not add the include to $vhost — no line matched 'server_name $DOMAIN;'"
```

---

### 5.59 Sáu shop chạy chung một image, nên "cùng image" không có nghĩa là "cùng nội dung"

`check_locale_drift` báo shop b2b đang chạy wording khác repo, 11690 bytes so với
11696. Ba giả thuyết bị loại bằng đo, theo thứ tự:

| Giả thuyết | Đo | Kết quả |
|---|---|---|
| b2b chạy image cũ hơn | `docker ps --format {{.Image}}` | cả sáu đều `spree-estate:latest` |
| có bind mount đè lên | `docker inspect --format {{range .Mounts}}` | b2b và ca có mount y hệt nhau, không cái nào mount locale |
| repo mới hơn image | `docker image inspect --format {{.Created}}` so với `stat` | image 19 Aug 05:36, file b2b sửa 19 Aug **13:45** |

Locale được nướng vào image lúc build. Sáu shop dùng chung một image, nên khi sửa
file wording của **một** shop mà không build lại, shop đó lệch còn năm shop kia
vẫn khớp — và cái lệch trông y hệt như một shop bị cấu hình sai riêng.

Hậu quả không phải thẩm mỹ. File cũ tham chiếu `%{nz_dollar}` trong khi template
truyền `ctry_dollar`. Theo §1 về I18n, placeholder không được cấp **vẫn in ra
nguyên văn khi không có tham số nào khác**, nhưng **raise `MissingInterpolationArgument`
khi có tham số khác** — và `pay_body_1` được gọi kèm năm tham số. Đo trên container
đang chạy:

```
5 built, 1 failed
  order_mailer.cancel_email: missing interpolation argument :nz_dollar
```

**Shop wholesale đang live và không gửi được email huỷ đơn.** Bản sửa đã nằm trong
repo từ 19 Aug và chưa từng vào image. Sau khi build lại và tái tạo sáu container:
`6 built, 0 failed`, và ảnh chụp dữ liệu sáu shop giống hệt trước sau.

Quy tắc: **sửa file gitignored mà không build lại thì không có gì thay đổi cả**, và
với image dùng chung, cái không đổi đó chỉ lộ ra ở một shop.

---

### 5.60 41 tiện ích `dark:` trong mã, và không cái nào từng chạy

Khi footer của shop wholesale chuyển sang nền tối, cách phản xạ là viết
`dark:text-white`. Trong repo này viết vậy là **không có tác dụng gì cả**, và
không có cảnh báo nào.

`globals.css` dòng 6 khai:

```css
@custom-variant dark (&:is(.dark *));
```

Đó là biến thể dark **theo class**, không theo `prefers-color-scheme`. Nghĩa là
`dark:` chỉ ăn khi có tổ tiên mang class `.dark`. Đo:

| | |
|---|---|
| số tiện ích `dark:` trong `src` | **41** |
| số chỗ gắn class `dark` lên `html`/`body` | **0** |
| số chỗ mount `ThemeProvider` | **0** |

`next-themes` có được import đúng một chỗ, `ui/sonner.tsx`, và chỉ để **đọc**
`useTheme()`, không có provider nào ở trên nó.

Nên 41 tiện ích đó là mã chết. Chúng nằm rải trong `ui/button.tsx`,
`ui/badge.tsx`, `ui/field.tsx`, `native-select.tsx` và cả
`WholesalePendingBrowse.tsx`, tức là ngay trong luồng của shop đóng.

Cái nguy không phải chúng vô dụng, mà là chúng **trông như đang bảo vệ mình**.
Người sửa giao diện tối tiếp theo sẽ thấy `dark:` khắp nơi, kết luận rằng chế độ
tối đã được lo, rồi thêm một cái nữa và không hiểu vì sao màu không đổi.

Cùng họ với `prefers-color-scheme` ở ngay dưới đó: nó khoá theo **thiết lập máy
của khách**, trong khi footer wholesale tối **bất kể khách để chế độ gì**. Hai cơ
chế, cả hai đều không nối với thứ thật sự quyết định màu, là cái cổng đăng nhập.

Quy tắc: **màu của một bề mặt phải do chính bề mặt đó quyết định.** Trong footer,
vòng focus giờ dùng `currentColor`, nên nó theo chữ, mà chữ thì theo livery.

---

### 5.61 Thay chuỗi không khớp thì im lặng, và tôi mắc lại đúng lỗi vừa sửa

Sáng 20 Aug đã vá `script/shop_host`: `sed` thoát 0 khi không khớp mẫu nào, nên
"đã chèn được" và "không tìm thấy chỗ để chèn" là cùng một mã thoát. Chiều cùng
ngày tôi mắc lại **bốn lần**, bằng Python:

```python
s = s.replace(old, new)      # không khớp → không đổi gì → không báo gì
open(p,'w').write(s)
print("   đã sửa")           # in ra, và sai
```

Lần nặng nhất: vá `TextImage` để ghép `basePath` vào href của nút hero. Chuỗi tìm
sai thụt lề (8 khoảng trắng thay vì 6). Lệnh chạy, in "đã sửa", tôi build, chụp
ảnh, **thấy nút hiện ra đúng chỗ** và suýt báo xong. Chỉ lộ ra khi đọc thuộc tính
`href` của chính nút đó trên trang: `/products` chứ không phải `/b2b/en/products`.

Trên shop đóng, cái href đó đẩy khách **ra ngoài cổng, về trang đăng nhập**.

Ba đặc điểm khiến nó nguy:

| | |
|---|---|
| Ảnh chụp **không** phát hiện được | Nút vẫn vẽ ra, đúng chữ, đúng chỗ, đúng màu |
| Test **không** phát hiện được | Test hỏi `blocks`, mà `blocks` đúng — sai nằm ở component vẽ |
| `tsc` **không** phát hiện được | `cta.href` là string hợp lệ |

Quy tắc: **mọi lần thay chuỗi phải có `assert` cho số lần khớp**, và sau khi vá
phải hỏi lại tệp xem dấu vết mới có ở đó không:

```python
assert s.count(old) == 1, f"khớp {s.count(old)} lần"
...
assert '${basePath}${cta.href}' in s, "vẫn chưa vá được"
assert 'href={cta.href}' not in s, "còn sót bản cũ"
```

Và với thứ hiện ra trên trang, **đọc thuộc tính chứ đừng nhìn hình**. Một cái nút
trỏ sai chỗ trông y hệt một cái nút trỏ đúng chỗ.

### 5.62 `@theme inline` thay giá trị vào lúc build, nên ghi đè biến không tới được utility

Danh sách của khách đọc như mười lỗi màu rời rạc trên chín trang. Nó là **một**
nguyên nhân: `globals.css` map cả thang xám của Tailwind sang màu xanh ô liu bán lẻ,
và 402 chỗ dùng utility trong 68 tệp đang lấy từ đó.

Bản vá đầu là một khối theme ghi đè `--color-gray-200` và các biến cùng họ. Nó đóng
được **8 trong 10** ý của khách, và đó chính là con số nguy: trông như cơ chế đã
đúng và chỉ còn hai chỗ sót. Phép đo kết thúc tranh luận, đọc biến và đọc phần tử
trong cùng một lần:

```json
{ "dataTheme": "black", "varGray200": "#d7d7d7",
  "probeBorder": "rgb(229, 232, 217)" }
```

Biến đã là `#d7d7d7`, phần tử `.border-gray-200` vẫn vẽ ô liu.

Nguyên nhân là chữ `inline` trên khối `@theme`. Nó **thế giá trị thẳng vào từng
utility lúc build**, không phát ra `var(--color-gray-200)`, nên class mang sẵn mã
màu và biến không còn ai đọc. Token vẫn hiệu lực với component đọc `var(--...)`
trực tiếp, và đó đúng là lý do 8/10 đóng được và cơ chế trông có vẻ ổn.

Cách sửa: ghi đè **chính utility**, và sinh danh sách từ những utility thật sự có
trong `src` chứ không gõ tay — 44 cái. `script/check_theme_css` giờ báo đỏ nếu có
`--color-*` bên trong khối `[data-theme]`, để không ai thử lại một cách thiện chí.

### 5.63 88 luật CSS sai cú pháp đã ship, và phép đo sau đó giống hệt phép đo trước

44 luật ghi đè utility được sinh bằng Python cho khỏi sót. F-string của nó co
`{{{{` thành `{{`, nên mỗi luật ra thành `.bg-gray-100{{background-color:#F5F5F5}}`.
Braces đôi là CSS không hợp lệ và parser **bỏ lặng** cả khai báo.

Build xanh. `tsc` xanh. `check_no_client_data` xanh. Shop deploy xong. Rồi phép đo
18 điểm trả về **từng byte giống hệt** lần chạy trước khi sửa — và cái đó bị đọc
thành "cơ chế sâu hơn tưởng", đẩy hai mươi phút tiếp theo vào cascade của Tailwind
thay vì vào tệp vừa mới ghi.

Dấu vết nằm ngay đó và không ai nhìn: chính khối vừa sinh ra. Một lệnh `grep` lên
sản phẩm là xong.

Nên quy tắc không phải "cẩn thận với regex". Là: **tệp do script ghi cần một cổng
đọc tệp, không phải đọc script**, và **kết quả trước và sau một thay đổi mà giống
hệt nhau thì bản thân đó là một phát hiện**, không phải một câu đố về framework.

### 5.64 `next/image` chỉ phục vụ được các bề rộng có trong `deviceSizes`/`imageSizes`

Khách gửi panel devtools: ảnh gốc 648 x 756, khung vẽ 653 x 762, kèm câu "the code
is changing the size it should be".

Có **hai** lỗi, không phải một:

| | |
|---|---|
| CSS | cột là `col-span-4` của 12, tức 1/3 viewport. Ở cửa sổ 1959px của khách thì bằng 653, rộng hơn tệp |
| Optimizer | `imageSizes` và `deviceSizes` không có 648, ứng viên nhỏ nhất từ 648 trở lên là **750**, nên mọi request đều phóng tệp 648 lên 16% rồi trình duyệt kéo xuống |

Và thẻ khai `width={800} height={600}`, tỉ lệ 4:3 cho ảnh dọc — không tệp nào trong
10 tệp brand có tỉ lệ đó, cả 10 đều đúng 648 x 756 (`sips` xác nhận, không tin trình
đọc JPEG tự viết).

Sửa: thêm 648 vào `imageSizes`, khai đúng kích thước thật, đặt `sizes` để trình
duyệt xin đúng 648, và `max-w-[648px]` để cột **co được mà không phình ra**. Chỉ đầu
phình là sai; thu nhỏ thì nét.

### 5.65 `naturalWidth` là kích thước thật chia cho density, và `currentSrc` đọc sớm thì trả về ứng viên lớn nhất

Hai con số trông như lỗi trong cùng một buổi, cả hai là lỗi của phép đo:

**`naturalWidth` 626 x 730 cho một tệp 648 x 756.** Không phải tệp, không phải
server: `curl` với mọi `Accept` đều trả về đúng 648 x 756, 196787 byte, y hệt tệp
gốc. Chromium chia kích thước thật cho density của ứng viên đã chọn. `sizes` khai
800, ứng viên là 828, nên 648 / (828/800) = 626,1. Panel About báo đúng 648 x 756,
tức density đúng bằng 1.0 — và đó là bằng chứng gọn nhất rằng bản vá 5.64 đã vào.

**Một shop báo `w=3840` trong khi sáu shop kia báo `w=648`.** Đọc như lỗi riêng của
shop đó. Là do probe chờ `domcontentloaded` cộng một khoảng cố định: trước khi
layout xong, trình duyệt có thể trả về ứng viên **lớn nhất** trong `srcset` vì
`sizes` chưa được tính. Đo lại với `waitUntil: "load"` cộng `img.decode()`: `w=648`,
đúng như sáu shop kia.

Đọc `currentSrc` hoặc `naturalWidth` thì phải sau `load` và sau `decode()`.

### 5.66 Middleware markdown vẫn "chạy" trên cả hai hệ, và không nơi nào làm được việc

Khách hỏi: file `markdown_negotiation.rb` còn dùng được không, hay cần viết mới cho
Next. Đo cả ba phía.

**5 shop 5.4 live của ổng: chạy thật.** `Accept: text/markdown` → 200 +
`text/markdown` trên ca/nz/au/us/nolocal (5298, 5727, 5263, 5485, 5246 byte). Nên
phần thương lượng đúng. Phần kết quả thì không:

| | |
|---|---|
| trang chủ ca | 219/259 dòng trống (84%) |
| heading | cả 8 cái thụt 12–14 space → CommonMark đọc thành **code block** |
| dấu `**` in nguyên văn | 18 lần |
| trang `/t/collections/on-sale` | HTML 120.650 byte → markdown 2.556 byte, tên sản phẩm **67 → 3** |

Dấu `**` là bug của file, không phải copy của khách: HTML của ổng có **0** dấu `**`.
Gốc là **thứ tự**:

```ruby
html.gsub!(/<strong[^>]*>(.*?)<\/strong>/mi) { "**#{$1.strip}**" }   # bước 6
...
html.gsub!('&nbsp;', ' ')                                            # bước 9
```

Nguồn là `<strong> your choice makes a difference.&nbsp;</strong>`. Lúc chạy bước 6,
`&nbsp;` **vẫn là chuỗi 6 ký tự**, `strip` không cắt được. Ra
`**...difference.&nbsp;**`. Tới bước 9 mới thành space → `**...difference. **`. Bold
mà trước dấu đóng có space thì CommonMark không tính là bold, nên in ra.
**Decode entity phải chạy TRƯỚC format inline.**

**Backend 5.6: nạp, chạy, và không có gì để chuyển.** Comment mình tự viết trong repo
bảo nó "inert" — **sai, đo ra là sai**. Nó có hai tác dụng thật: chuyển trang đăng
nhập admin (42.228 → 1.281 byte) khi Accept có cả markdown lẫn html, và dán
`content-type: text/markdown` lên các response 301/302/401 **body rỗng**. Với
`Accept: text/markdown` trơ trọi thì Rails trả **406** trước khi render, nên đúng
cái cách mà comment của nó ghi lại là cách không bao giờ tới được nó.

Không có gì khách hàng thấy được chạm tới nó: không gem storefront trong
`Gemfile.lock`, không mount storefront trong routes, không view khách, và
`/products` `/cart` `/pages/about` đều 404.

**Bên Next: không chỗ nào đọc `Accept`.** Và Next 16 middleware **không đọc/sửa được
body**, nên phải là route handler. Nhưng tin tốt: copy trang **đã sẵn là markdown**
trong content map, nên endpoint mới phát nguồn ra thẳng, không parse HTML — không
mất tên sản phẩm, không vỡ bold.

Một thứ **không đo được từ ngoài**: bot AI thật gửi `Accept` gì. `Accept: */*` trả
HTML thường. Nếu ClaudeBot/GPTBot gửi `*/*` thì middleware này chưa từng phục vụ một
bot nào và `llms.txt` mới là thứ làm việc. Một dòng access log trả lời.

### 5.67 `Disallow: /` không phải noindex, và có thể khiến trang bị index vĩnh viễn

6 trong 7 review host mở cho Google 9 ngày: `Allow: /`, không noindex ở đâu, và thẻ
canonical **trỏ vào chính nó**. Tức 6 bản sao của shop đang live, mỗi bản khai mình
là bản gốc.

Phản xạ là `Disallow: /`. Nó là công cụ **yếu hơn**, và có thể phản tác dụng:

- `Disallow` chặn **crawl**, không chặn **index**. Một URL có thể vào index chỉ từ
  link ngoài, không cần được fetch lần nào
- và khi đã vào rồi, `Disallow` **đảm bảo nó ở lại**, vì crawler không còn fetch
  được trang để thấy `noindex`

`X-Robots-Tag: noindex` mới là cái lấy nó ra, và nó **chỉ hiệu lực nếu crawl được
cho phép** để đọc header. Dùng header chứ không dùng meta tag, vì header phủ cả
sitemap, feed và ảnh — những thứ không có `<head>`.

`always` trên `add_header` là bắt buộc: không có nó nginx chỉ gắn header cho một danh
sách status ngắn, nên 301 và 404 đi ra không mang dấu — mà redirect đúng là thứ
crawler đi theo.

Kế thừa: nginx chỉ bỏ `add_header` của cha trong location **có add_header riêng**.
Đã kiểm bằng cách hỏi cả `/` lẫn `/robots.txt` (robots.txt do một include khác phục
vụ), không phải bằng cách đọc tài liệu nginx.

Ngoại lệ duy nhất là shop sỉ đóng: ở đó `Disallow: /` mới đúng, vì không nên fetch
gì cả, và cổng của nó đang assert điều đó.

### 5.68 `networkidle` đang đỡ cho 4 assertion không có wait riêng, bỏ nó ra là hở cả 4

`check_storefront_e2e` chờ `networkidle` ở mọi navigation. Đó là **câu hỏi sai** với
framework có streaming: đo trên trang chủ một shop, **113 request xong và 1 request
`?_rsc=` mở vô hạn**, nên network không bao giờ idle và `goto` cháy hết timeout.

Nó **pass suốt nhiều tuần** — đó là tính chất tệ nhất một cái wait có thể có. Chỉ đỏ
khi một buổi chiều build nhiều làm box chậm, và phản xạ đầu tiên là "thay đổi vừa rồi
làm hỏng shop". Không phải: tháo thay đổi đó khỏi 1 shop rồi đo lại, hai stream vẫn
mở nguyên.

Rồi tới bài học thật. Thay bằng `domcontentloaded` làm **hở 4 assertion** vốn âm thầm
dựa vào nó:

| assertion | báo sai thành |
|---|---|
| header có logo | `false` trên shop có 1 img + 3 span |
| số row sản phẩm | `0` |
| ảnh render | `8/49` trên shop mà cả 49 ảnh đều render |
| **add to cart** | **`false` trên 4 shop bán được hàng bình thường** |

Cái cuối là assertion **quan trọng nhất cả file** — chính lý do file này tồn tại.

Nên: **wait thuộc về assertion, không thuộc về navigation.** Mỗi cái giờ tự poll đến
khi điều nó khẳng định thành đúng. Và 2 trong 4 còn sai theo cách `networkidle` đang
che: "mọi ảnh đã complete" là **hiển nhiên đúng** với 3 ảnh tồn tại trước khi ảnh
lazy được tạo ra, nên phải đòi thêm điều kiện **tập ảnh ngừng lớn lên** — đó là lý do
nó từng báo 8/49.

### 5.69 Clean URLs: cái prefix có HAI nơi biết nó, không phải một

Chuyển 6 shop sang URL sạch (bỏ /{country}/{locale}). Scope ban đầu ghi "chỉ 3
file, và basePathFor là nơi DUY NHẤT biết prefix". Sai. Có nơi thứ hai:
`extractBasePath()`, 17 client component đọc prefix từ URL hiện tại thay vì từ
config.

Và đó là bug thật duy nhất mà clean URLs lộ ra. Trên `/products/<slug>` nó đoán
`/products/<slug>` LÀ prefix, nên cart drawer link tới `/products/<slug>/cart` và
`/products/<slug>/checkout/cart_xxx`. Ba cái 404 trong browser walk. **Không thấy
được trong HTML** vì các link đó chỉ render sau add-to-cart. Ẩn suốt bao lâu prefix
còn tồn tại, vì đoán "2 segment đầu" là đúng khi địa chỉ thật sự bắt đầu bằng
country/locale.

Bài học: khi một comment nói "đây là nơi duy nhất biết X", hãy `grep` toàn repo
trước khi tin. Ở đây là `grep -rn extractBasePath`, ra 17 chỗ.

### 5.70 Canonical trỏ vào chính cái redirect nó vừa tạo

Clean URLs phục vụ `/products` (200) và 308 `/nz/en/products` về `/products`. Nhưng
thẻ canonical trên `/products` vẫn ghi `/nz/en/products` — tức trỏ vào một địa chỉ
redirect đi chỗ khác. Với SEO điều này tệ hơn không có canonical.

Đo được vì kiểm CẢ HAI: `/products` = 200, canonical = `/nz/en/products`. Nếu chỉ
kiểm status code thì xanh, và đây đúng là mục tiêu SEO của ổng.

Gốc: `buildLocalizedAlternates` gọi `withLocalePrefix(country, locale, path)` cứng.
Sửa: khi clean URLs bật thì canonical là URL sạch, và bỏ cụm hreflang thay vì dựng
lại không prefix — hreflang tồn tại để phân biệt biến thể locale, mà clean URLs
không để biến thể nào trong URL. Đúng ý ổng: shop lớn lên thành nhiều nước/ngôn ngữ
"sau", không phải bây giờ.

### 5.71 Cổng shop đóng chỉ chạy ở nhánh có prefix, và clean URLs thêm một nhánh phục vụ trang

Đây là mối nguy mà clean URLs được làm sau một cờ mặc-định-tắt vì nó. Trước đây, địa
chỉ KHÔNG prefix chỉ có thể bị REDIRECT, nên cổng nằm trong nhánh xử lý địa chỉ CÓ
prefix — nhánh duy nhất phục vụ được một trang. Clean URLs khiến nhánh không-prefix
phục vụ trang. Một `rewrite` thêm vào đó mà thiếu cổng sẽ công khai toàn bộ catalogue
sỉ và giá sỉ cho bất kỳ ai có link, và mọi ảnh chụp trông vẫn hoàn hảo.

Cách làm đúng: rút cổng thành MỘT hàm, hai nơi gọi (nhánh có prefix và nhánh không).
Một cổng chép ra hai bản là một cổng sẽ trôi: hai bản sửa vào hai ngày khác nhau, và
shop đóng là bản lặng lẽ ngừng đóng. 24 test mới, viết dưới dạng THỬ vượt qua cổng
chứ không phải xác nhận cổng.

Và `check_shop_gate.mjs` giờ tự dò shape URL (probe một trang policy: 200 = sạch,
3xx = có prefix) thay vì bị truyền vào. Một check bị truyền sai cờ là check chạy sai
đúng ngày cần nó.

### 5.72 "complete" của ảnh gồm cả ảnh hỏng, nên chờ "complete" rồi đếm "loaded" là một cuộc đua

Browser walk báo au 53/54 ảnh, lặp lại được, trong khi đo trực tiếp (chờ 9s) ra
54/54. Không phải ảnh hỏng — là đua giữa hai phép đo.

`until` dừng khi `done === total` với done = `complete`. Nhưng một ảnh HỎNG có
`complete:true, naturalWidth:0`, và phép đếm cuối lại dùng `complete && naturalWidth
> 0`. Một ảnh carousel đang đổi khung thỏa cái đầu, trượt cái sau. Sửa: `until` chờ
đúng con số mà check sẽ báo (`complete && naturalWidth > 0`), và ổn định qua HAI lần
poll chứ không chỉ một, vì một hàng lazy có thể thêm ảnh một nhịp sau khi total đứng
yên.

---

## 7. Danh sách kiểm trước khi tin một kết quả

Gộp từ 19 Aug, ngày có chín lỗi và **không lỗi nào lộ ra khi đọc code**. Sáu trong
số đó có chung một hình: phép đo chạy đúng, trả lời trung thực, nhưng **trả lời một
câu hỏi khác với câu đang cần**.

Mỗi dòng dưới đây là một câu phải tự hỏi, kèm ca thật đã sinh ra nó.

### 7.1 Phép đo có đang trả lời đúng câu hỏi không

| hỏi sai | hỏi đúng | ca thật |
|---|---|---|
| khoá có tồn tại không | **giá trị trong đó là gì** | một shop toàn cầu có khoá tên-vùng, và nội dung của nó là khoá shop nội bộ của chính chúng ta. In 21 lần trong 6 email gửi khách |
| bao nhiêu bản ghi | **đếm theo scope nào** | 47 với 42 sản phẩm là cùng một dữ liệu, khác nhau ở chỗ có tính bản xoá mềm hay không. Suýt báo khách mất dữ liệu |
| file đã chuyển chưa | **checksum có khớp không** | `ssh -n` khiến file tới nơi 0 byte. `test -f` gọi là đạt |
| vòng lặp thoát 0 chưa | **nó xử lý đủ số dòng chưa** | in "15 thành công, 0 lỗi" trên danh sách 16 dòng |
| template render được không | **render với dữ liệu của shop này không** | shop thương mại đỏ 3/3 vì shop chỉ có một đơn dựng dở, không phải vì template hỏng |
| build có chạy không | **build từ mã nào** | `/srv/_build` chưa từng được làm mới, biên dịch mã của hôm trước |

**Quy tắc rút gọn: một kết quả xanh chỉ chứng minh về chính câu hỏi đã đặt.**
Trước khi tin, đọc lại câu hỏi.

### 7.2 Một bản vá cũng là một thay đổi hành vi

Hai lần trong ngày, sửa đúng chỗ A làm hỏng chỗ B ngay cạnh:

- `ssh -n` vá được vòng lặp bị nuốt stdin, và **phá** mọi lệnh cần stdin để nhận nội
  dung. Hàm ssh dùng chung phải tách hai: chạy lệnh thì `-n`, đẩy nội dung thì không
- Bắt middleware gác đường dẫn có dấu chấm vá được lỗ hổng slug, và **chặn luôn**
  `/robots.txt` khiến nó trả 307. Crawler đọc 307 ở đó là "site không có robots.txt"
  rồi bò tự do, tức là vá xong lại mở rộng hơn trước

Sau mỗi bản vá, hỏi: **lệnh này còn ai khác đang dùng theo cách khác không.**

### 7.3 File khách gửi không phải tập cha của file đang cài

File mới **nhỏ hơn** file cũ ba lần trong một buổi, và phần nhỏ đi là nội dung thật:
16 khoá email giao hàng, 6 dòng thanh toán, 2 dòng cảnh báo lừa đảo.

Đếm khoá hai bên **trước** khi cài. `script/locale_diff <file> <shop>` làm việc đó,
phân biệt được "mất" với "dời cấp", và `--merge` giữ giá trị của khách đè lên bản cũ
rồi tự chứng minh không giá trị nào của khách bị đổi.

Ngoại lệ do khách quyết: shop thương mại thì **thay hẳn**, vì các mục cũ mô tả một
quy trình shop đó không chạy. Khác biệt nằm ở shop, không nằm ở nguyên tắc.

### 7.4 Thứ mình tự viết chịu đúng những cổng đó

- Cổng `check_locale_drift` mới viết bị `check_no_client_data` chặn vì chú thích nêu
  tên shop khách, trong một repo công khai
- Cờ `--drop` được đọc, được nhắc trong thông báo, và **không làm gì cả** cho tới khi
  bị kiểm. Một cờ nói dối tệ hơn không có cờ
- `check_copy_markup` báo đỏ đoạn `<script>` của widget chat, vì JavaScript đầy dấu
  ngoặc. Báo nhầm ở cổng này nguy hiểm riêng: nó là cổng người ta đọc ngay trước khi
  dán chữ của khách vào, nên một lần kêu oan là một lần người ta bắt đầu bỏ qua nó

### 7.5 Deploy chỉ mang thứ nó biết

`git ls-files` là thứ deploy gửi. File mới chưa `git add` thì không tới nơi, và lỗi
hiện ra dưới cái tên chẳng liên quan: `module not found`, nêu tên file **nhập** chứ
không nêu file thiếu. `check_untracked_source` giờ soi cả `storefront/src` và cả đuôi
`.ts/.tsx/.mjs`, vì trước đó nó chỉ biết `.rb/.erb/.rake`.

## 8 Ảnh chụp một trang stream là một lời khai có mốc thời gian

Footer của storefront lấy danh sách policy qua một lần fetch nằm trong Suspense, nên
nó **render hai lần**: một lần với cột rỗng, một lần đủ 4 link. Ảnh chụp sau
`domcontentloaded` 3 giây bắt đúng nhịp đầu, và cột "Terms and Policies" hiện ra là
một tiêu đề không có gì bên dưới.

Đọc ảnh đó, tôi kết luận trang lỗi và sửa `Footer.tsx`: bọc cả cột trong
`policies.length > 0`. Sửa xong mới đi đo DOM, và DOM trả về 4 `li`, chữ trắng, cao
16px, `href` đúng cả 4. Đo lại trên **cả 6 shop**: shop nào cũng 4. Không có shop nào
0 policy. Cái lỗi tôi sửa chưa từng tồn tại.

Ba điều rút ra, theo đúng thứ tự chúng đắt:

1. **Đọc DOM trước, ảnh sau.** Ảnh nói *lúc đó trông thế nào*, không nói *nó là gì*.
   Ngược thứ tự thì một độ trễ 200ms biến thành một bug tưởng tượng.
2. **Đo cả hai phía trước khi sửa component chung.** Component này 6 shop dùng. Sửa
   dựa trên một shop, mà lại là một khoảnh khắc của một shop, là sửa 6 chỗ vì 0 lỗi.
3. **`pnpm run format` đụng cả file.** Một hunk 3 dòng của tôi kéo theo 136 dòng
   biome reindent trong cùng file. Lúc hoàn lại thì may, vì hoàn tất cả là đúng; nếu
   hunk đó có phần cần giữ thì đã phải gỡ tay 222 dòng.

Cách đo đúng: `until()` chờ điều kiện (`li` > 0), chụp sau khi điều kiện đạt, và nếu
điều kiện không đạt thì **báo là không đạt** chứ đừng chụp rồi đọc ảnh.

## 9 Một con số khách đã nói mà không có cổng giữ thì sẽ trôi

Bốn giá trị ông ấy đưa đã được làm đúng một lần rồi mất, và mỗi lần mất theo một
đường khác nhau:

| Giá trị | Mất vì |
|---|---|
| Tiêu đề hero hai dòng | Copy là một string, không có `\n` |
| Màu hover `#065146` | CSS sinh ra sau đó thắng specificity, hoà (0,2,0) và nằm dưới |
| Đường 1px dưới header | Header lấy luôn màu của bar, nên border 1px nằm trong khối 64px cùng màu |
| Ảnh About không bị cắt | Copy dài ra làm panel cao lên, `object-cover` gọt 29.3% bề ngang |

Không cái nào là đọc sai ghi chú. Cả bốn đều đọc đúng, làm đúng, rồi bị thứ khác
huỷ: một lần build lại, một component 6 shop dùng chung, một token copy từ shop bên
cạnh. Thứ duy nhất phát hiện ra là **chính ông ấy nói lại lần hai**.

Nên `.client_notes` + `script/check_client_notes` ra đời: mọi giá trị ông ấy từng
nói, kèm ngày nói và **nguyên văn lời ông ấy**, kiểm trực tiếp trên trang đang chạy,
cả 7 shop. Nói lại lần hai giờ là cổng đỏ ở đây, không phải tin nhắn từ ông ấy.

### 9.1 Ba lỗi của chính cái cổng đó, trong 20 phút đầu

1. **Đọc màu giữa lúc transition.** Cổng lấy giá trị đầu tiên khác giá trị nghỉ, và
   nhận `#0D4138` trên card kết thúc ở `#065146`. `#0D4138` chỉ là một điểm trên
   đường nội suy giữa hai màu. Phải chờ giá trị **ngừng đổi** rồi mới so.
2. **Đo trang đăng nhập như trang chủ.** Shop có cổng login trả về form, và cổng báo
   "không thấy strip trên header" trên một shop có strip hoàn toàn bình thường.
3. **Dò field password ngay tại `domcontentloaded`.** Form là client component nên
   lúc đó chưa có, đếm ra 0, và nhánh đăng nhập không chạy. Phải poll: hoặc thấy
   password, hoặc thấy strip, cái nào tới trước.

Một cổng báo oan còn tệ hơn không có cổng, vì nó là cổng người ta đọc ngay trước khi
tuyên bố xong việc. Cả ba lỗi trên đều làm nó báo oan.

## 10 `git checkout --` phục hồi từ index, không phải từ HEAD

Ngày 24 Aug, để bỏ một sửa đổi nhỏ của chính mình trong `Footer.tsx`, tôi chạy:

```
git checkout -- storefront/src/components/layout/Footer.tsx
```

Nó không trả file về trạng thái trước khi tôi sửa. Nó trả về **bản trong index**,
và xoá sạch mọi thay đổi chưa stage của file đó — gồm cả toàn bộ phần chuyển footer
sang livery và phần sửa thứ tự policy, việc của mấy tuần trước.

`git diff --stat` trước đó in `136 insertions, 86 deletions`. Tôi đọc con số đó là
"biome vừa reindent cả file" và không sai hoàn toàn: biome **có** reindent 222 dòng.
Nhưng trong cùng khối diff đó có việc thật, và một con số tổng không phân biệt được
hai thứ.

Hai shop được build lại từ file đó trong vòng một giờ. Không cổng nào phát hiện, vì
`check_client_notes` lúc đó chỉ soi phần trên trang: theme vẫn đúng, header đúng,
hero đúng, hover đúng, 8 trên 8 xanh. Người phát hiện là khách, qua ảnh chụp:
*"why has the bottom gone back to the standard shop colours?"*

### 10.1 Ba việc phải làm, theo thứ tự

1. **Đừng dùng `git checkout --` để bỏ sửa đổi của chính mình.** Dùng Edit để đảo
   lại đúng phần vừa thêm. `git checkout --` là công cụ cho một file mình không hiểu
   trạng thái, và nó không hỏi lại.
2. **Repo này lúc đó có 73 file với 4,991 dòng chưa stage**, 50 file thuộc dạng `MM`
   hoặc `AM` — index giữ bản cũ, nên restore ra một file *trông hoàn toàn hợp lý*.
   Đã `git add -A` toàn bộ: giờ index giữ đúng sự thật, và cùng câu lệnh đó trở
   thành vô hại.
3. **Cổng phải soi cả trang, không chỉ nửa trên.** Thêm `footer_surface`,
   `footer_bar`, `footer_policies`, `footer_absent` vào `.client_notes` cho cả 7
   shop. Chạy lại: bắt đúng 5 giá trị của đúng hai shop bị build lại, năm shop kia
   xanh. Đó là lần đầu cổng này chứng minh nó không xanh suông.

### 10.2 Và lần thứ ba của cùng một lỗi chụp ảnh

Ảnh footer đầu tiên sau khi sửa cho thấy cột brand **trống**. Không phải lỗi trang:
`<img>` có trong DOM, `loading="lazy"`, và chưa nạp lúc bấm chụp. Cùng họ với §8.

Giờ trước khi chụp phải đợi **ba** điều: link policy đã có, `img.complete &&
naturalWidth > 0` cho **mọi** ảnh trong khung, rồi mới settle. Đếm được thì mới chụp;
không đếm được thì báo "NEVER SETTLED" chứ đừng chụp rồi đọc ảnh.

## 11 Sitemap trả 200, đúng content type, 76 KB, và không phải là XML

Khách đọc file rồi báo. Không cổng nào của mình phát hiện, vì mọi cổng chỉ hỏi
"nó có trả lời không", "header nói gì", "nặng bao nhiêu" — không cổng nào hỏi
**"nó có phải XML không"**.

```
https://<shop>/sitemap/0.xml   ->  200, application/xml, 76216 bytes
ET.fromstring()                ->  not well-formed (invalid token): line 114, column 199
```

Ba ảnh sản phẩm của ông ấy có dấu `&` trong tên file. ActiveStorage giữ nguyên tên
file gốc trong đường dẫn URL, Next ghi URL đó vào `<image:loc>` **không escape**, và
một dấu `&` trơ khiến parser bỏ cả tài liệu. Trên **mọi** shop.

Đo phạm vi sau khi sửa: **112 URL** trên toàn bộ 7 shop từng mang `&` trơ. Ông ấy
thấy 3 trên một shop; riêng nolocal có **102**.

### 11.1 Tại sao percent-encode chứ không XML-escape

Đề xuất của ông ấy là escape thành `&amp;`, và nó chạy được hôm nay. Không chọn, vì
**Next viết thẻ, không phải mình**. Ngày nào serialiser của nó bắt đầu escape thì mọi
URL mình escape trước thành `&amp;amp;` và sitemap hỏng theo chiều khác — mà không
test nào phát hiện, vì tài liệu vẫn parse được.

`%26` không có ràng buộc đó: là URL hợp lệ, đã an toàn XML, và đúng bất kể phía sau
có escape hay không. Đo trên chính file của ông ấy: link `&` và link `%26` cùng trả
200, cùng 75463 bytes.

Hai thứ **không** encode, và mỗi thứ là một cách làm hỏng 200 URL:

| Không encode | Vì |
|---|---|
| `%` | 71 trong 215 URL ảnh của một shop đã có percent-encoding từ khoá blob đã ký. Encode `%` thành `%25` là 404 cả 71 cái |
| query string | `&` ở đó là dấu phân cách tham số. Hôm nay không URL nào có query, và nếu có thì test cạnh file sẽ đỏ chứ không âm thầm ship XML sai |

### 11.2 Cổng phải hỏi câu mà parser tồn tại để trả lời

Thêm vào `check_storefront_e2e.mjs`: tải sitemap index, đi theo từng chunk nó khai,
và parse bằng `DOMParser` **thật của browser** chứ không phải regex. Lỗi nằm trong
chunk, không nằm trong index, nên chỉ kiểm index là đúng cách để nó sống sót.

Kiểm ngược bằng chính file trước khi sửa:

```
before the fix  CAUGHT: error on line 114 at column 200: xmlParseEntityRef: no name
after the fix   parses
```

Một regex xấp xỉ "well-formed XML" sẽ cho qua đúng cái tài liệu đã ship.

## 12 Lần thứ hai đọc hậu quả của chính mình như phát hiện

Chạy `check_all` ngay sau khi rebuild 7 storefront và restart 7 backend.
`check_client_notes` đỏ. Chạy lại một phút sau, khi mọi thứ đã lên: **59/59 xanh**.

Không có gì trôi. Một shop đang giữa lúc khởi động lại lúc cổng hỏi nó.

§7 của tài liệu này đã ghi đúng chuyện này (reload nginx giữa lúc tự đi khảo sát 6
shop, rồi đọc lỗi đó thành finding, mất 20 phút). Ghi lại vì nó lặp, và vì cái lặp
mới là thứ đáng ghi: biết luật không đủ, luật phải nằm trong tay chứ không nằm trong
đầu.

Quy tắc: sau bất kỳ lệnh nào restart hoặc rebuild, cổng nào hỏi tiến trình đang chạy
phải đợi nó trả lời `/up` trước. `script/shop_host start` đã đợi đúng thế cho từng
shop; cái thiếu là đợi **tất cả** trước khi hỏi cái đầu tiên.

### 12.1 Và một cổng đỏ vì lý do thật

Sau khi ổn định, `check_all` còn đúng một cổng đỏ: `check_shop_runtime`, trên 6 trong
7 shop. Nó đỏ vì dữ liệu thật, không phải vì code:

| shop | lỗi |
|---|---|
| 4 shop retail | 2 sản phẩm digital đang active mỗi shop, 0 method phục vụ chúng |
| shop retail thứ năm | 1 sản phẩm, cùng lỗi |
| shop thứ sáu | 8 sản phẩm `Default`, 0 method, không bán được gì |
| shop wholesale | sạch |

Để nó đỏ. Khách thêm được vào giỏ rồi không có lựa chọn giao hàng, nên câu "shop
chạy được" là sai cho tới khi sửa. Một cổng xanh giả còn tệ hơn cổng đỏ.

## 13 Override một format của template là âm thầm mất format kia

Dựng bản email riêng cho một shop qua view path riêng: đặt `welcome_email.html.erb`
vào thư mục của shop đó, giữ nguyên `welcome_email.text.erb` dùng chung.

Kết quả: **phần text của email rỗng**.

```
ok    customer_mailer.welcome    html 17351 B, text 0 B
```

ActionMailer lấy template cho một action từ **resolver đầu tiên có kết quả**, không
gộp qua các resolver. Thư mục shop chỉ có `.html.erb` nên nó thắng, và
`.text.erb` dùng chung không bao giờ được xét tới. Không có lỗi, không có cảnh báo,
`emails:smoke` in ra `ok`.

Một email không có phần text bị nhiều bộ lọc chấm điểm spam cao hơn, và trên client
chỉ đọc text thì nó rỗng hoàn toàn.

**Quy tắc: override một template thì phải cấp đủ MỌI format của nó.**

### 13.1 Ba lỗi nữa chỉ nhìn ảnh render mới thấy

1. **Bullet in ra `[0, "Designed for..."]`.** Key `why_shop_bullets` viết dạng danh
   sách thụt lề nên I18n trả về **Hash khoá theo vị trí**, không phải Array. Lặp nó
   ra cặp `[index, value]` và cả cặp bị in cho khách. HTML hợp lệ, chữ đủ, không ô
   nào rỗng — không cổng nào bắt được.
2. **Logo email trả 500.** Bản ghi blob có trong DB mà file không có trên volume, nên
   trình xử lý variant không đọc được nguồn. Gắn lại thì 200. Đã kiểm nó sống qua
   restart: cùng key, `exists? true`, cùng volume. Nên **không** phải lỗi hạ tầng, và
   không báo khách như vậy.
3. **Logo email là webp.** Spree dựng variant qua `spree_image_variant_options`, trả
   `image/webp` 17,400 bytes. Outlook trên Windows không render webp. Chưa sửa, đã
   ghi lại: nó là mặc định của Spree nên ảnh hưởng mọi shop có logo đính kèm.

## 14 Layout bị bỏ vì cổng hỏi về một file không ai render

Dựng template email riêng cho một shop qua view path riêng. Render ra: **không có
`<html>`, không header, không logo, không footer** — chỉ có phần thân mình viết.

Thủ phạm là `app/mailers/concerns/spree/full_document_templates.rb`. Nó quyết định
có dùng layout hay không bằng cách đọc

```ruby
Rails.root.join('app/views/spree', dir, "#{action}.html.erb")
```

tức file **dùng chung**. File dùng chung của khách là một tài liệu hoàn chỉnh có
`<html>`, nên nó trả `true` và layout bị bỏ. Nhưng file thật sự được render là bản
riêng của shop, và bản đó là fragment.

Cổng hỏi đúng câu, về sai file. Đã sửa: nếu shop có bản riêng thì hỏi bản riêng.

### 14.1 Bốn lỗi khác của cùng một buổi, cùng một cách phát hiện

Không cái nào bị cổng nào bắt. Cả bốn đều lộ ra khi **render rồi nhìn ảnh**.

| Lỗi | Vì sao cổng không thấy |
|---|---|
| Phần text rỗng | Mail vẫn build, `emails:smoke` in `ok`, chỉ có `text 0 B` trong dòng thống kê |
| Bullet in ra `[0, "..."]` | HTML hợp lệ, chữ đủ, không ô nào rỗng |
| Nhãn cột và nhãn tổng tiền trống | Tra sai scope: chữ nằm ở `order_ref`, mình hỏi `order_confirm`. Key không tồn tại thì I18n trả rỗng, không raise |
| `<strong>` in ra thành chữ | Chuỗi của khách có HTML, mình xuất escaped |

Cái thứ ba đáng nhớ nhất: file wording của khách chia làm **ba** scope
(`common`, `order_confirm`, `order_ref`) và không có gì nói cho biết. Hỏi nhầm scope
thì email ra đúng bố cục, đúng số tiền, và **mất hết nhãn**.

### 14.2 Preview một email cho shop chưa có đơn nào

Shop đó chưa có đơn hoàn tất nên `emails:smoke` bỏ qua email xác nhận, và tạo đơn
thật trong DB khách chỉ để chụp ảnh là để lại rác trên một shop sắp chạy thật.

Cách làm: dựng đơn trong một transaction rồi `raise ActiveRecord::Rollback`. In ra
`orders left behind: 0` mỗi lần chạy, và đó là dòng đáng in.

Hai bẫy trên đường: Spree validate state và định dạng zipcode **theo từng nước**, nên
địa chỉ preview phải dựng trên nước không đòi cả hai. Và đọc `mail.html_part` trước
khi mail render xong thì trả về thân không layout — làm mình tưởng layout hỏng lần
thứ hai.

## 15 Bộ tối ưu ảnh trả về nguyên bản ở mọi kích thước, và thỉnh thoảng treo luôn

`sharp` không có trong image runtime. pnpm liên kết nó bằng symlink vào `.pnpm/`,
còn bộ dò phụ thuộc của Next standalone không đi theo symlink, nên bản build cuối
không mang theo nó.

Không có gì lỗi. Không có gì ghi log. `/_next/image` vẫn trả **200** cho mọi yêu
cầu, và trả **đúng file gốc** ở mọi chiều rộng. Đo trên shop đang chạy ngày 25/8,
trước khi sửa:

```
hero-au.jpg  w=256   200  263,993 B  giải mã 648 x 756
hero-au.jpg  w=384   200  263,993 B  giải mã 648 x 756
hero-au.jpg  w=640   200  263,993 B  giải mã 648 x 756
file trên đĩa                        648 x 756, 263,993 B
```

Một cái điện thoại vẽ tấm ảnh đó rộng 390px vẫn tải đủ 264 KB. Cả 7 shop, nhiều
tuần. Có `sharp` rồi thì ba yêu cầu đó trả **11 KB, 18 KB và 33 KB** WebP.

Triệu chứng thứ hai lạ hơn và nặng hơn: **yêu cầu đầu tiên cho một kích thước chưa
cache có thể treo vĩnh viễn**. Next gộp các yêu cầu trùng key, nên một cái treo là
mọi cái sau treo theo. Lúc phát hiện có đúng hai key đang kẹt, `about.jpg&w=640`
trên một shop và `w=1080` trên shop khác, cả hai **504 sau 120 giây**, và cả hai
khỏi ngay khi restart container. Nghĩa là tấm ảnh About **không bao giờ hiện** ở
đúng chiều rộng đó, trên shop đó, cho tới khi có người restart.

Ba điều rút ra:

1. **Header `Accept` là một phần của khóa cache.** `curl` trần trả 200 trong 1,7
   giây ngay bên cạnh một key đang treo. Chỉ khi gửi `image/avif,image/webp,...`
   như trình duyệt thì mới chạm được vào cái treo. Mọi lần kiểm bằng tay trước đó
   đều xanh vì thiếu đúng cái header này.
2. **Trình duyệt không nói được gì cả.** Trang render, ảnh nét, screenshot hoàn hảo.
   Chỉ có **số byte** mới nói ra sự thật. `script/check_image_optimizer` đọc byte.
3. **Dockerfile giờ tự chứng minh.** Stage runner chạy `sharp` resize một ảnh 64x64
   thật; `require()` không đủ, vì nó vẫn qua khi thiếu binary musl. Build đỏ tại chỗ
   thay vì hỏng ở request đầu tiên.

## 16 Đo một chiều rộng là không đo gì cả

Dải màu xanh quanh ảnh About mà khách khoanh hai lần và viết "No space": nó **không
phải lề**. Nó là số học, và nó đổi theo chiều rộng cửa sổ.

Chiều cao panel do **cột chữ** quyết định. Ảnh giữ tỉ lệ của chính nó và rộng bằng
1/3 panel, nên cao = (rộng panel / 3) / tỉ lệ ảnh. Phần dư chính là dải màu:

```
          768px    5 shop 351px    shop thứ 6 635px
         1024px    5 shop 148px    shop thứ 6 427px
         1280px    5 shop  đủ      shop thứ 6 270px
         1440px    5 shop  đủ      shop thứ 6 205px
         1600px    5 shop  đủ      shop thứ 6 141px
         1920px    5 shop  đủ      shop thứ 6  10px
```

**Ở 1600px thì 5 trên 6 shop trông hoàn hảo.** Mọi lần kiểm trước đều đo ở một chiều
rộng duy nhất, thường là 1600, và ở đúng chỗ đó lỗi không xuất hiện. Phép đo đúng,
chỗ đo sai, và dải màu sống sót qua ba vòng review.

Sửa: dùng đúng file ảnh khách gửi lại (648 x 1069, đúng hình dạng panel) và chuyển
điểm gãy hai cột từ 768px lên 1280px. `script/check_about_panel` giờ đo **8 chiều
rộng trên cả 7 shop**, tự đăng nhập vào shop đóng, và **đỏ khi có shop không đo
được** thay vì báo xanh.

Ba cái bẫy trong chính con probe đó, mỗi cái đều từng cho ra số sai:

1. `naturalWidth` đọc được **388 x 453** cho một file 648 x 756: Chromium phơi ảnh
   JPEG progressive ở kích thước tạm trong lúc giải mã. Tỉ lệ vẫn đúng nên kết luận
   vẫn đúng, nhưng con số in ra là sai, và con số đó là thứ gửi cho khách.
2. Đổi viewport trên **cùng một page** làm srcset chọn ứng viên khác, và trong lúc
   ứng viên mới tải thì trình duyệt vẫn giữ ảnh giải mã cũ. Mỗi chiều rộng phải là
   một page mới.
3. `loading="lazy"` + viewport hẹp: ảnh **không bao giờ được yêu cầu**, probe đọc
   `naturalWidth 0` và báo "không giải mã được" trên một shop hoàn toàn bình thường.

## 17 Tài liệu khách gửi trộn lẫn NỘI DUNG cho khách và GHI CHÚ cho mình

Bốn file .docx ngày 25/8 vừa là copy trang, vừa là chỉ dẫn bố cục viết cho người
dựng trang. Cùng một định dạng, cùng một đoạn văn, không có gì phân biệt:

```
Tracking Times Can Change
International freight schedules can be affected by port congestion, ...     <- copy
I prefer this as a paragraph rather than eight bullets.                     <- ghi chú
It considerably reduces the apparent length of the page.                    <- ghi chú
I'd use  #4c5537 green here.                                                <- ghi chú
```

In nhầm một dòng ghi chú ra trang là khách đọc được lời khách nói với mình. Hai
dòng suýt lọt:

1. `Production → Project Management → Sea Freight / Air Freight / Rail Freight →
   Delivery` — đây là **mô tả** tấm ảnh, nằm ngay dưới câu "I would not put any
   additional text over this image." In nó lên chính là làm đúng cái ông bảo đừng.
2. `Find it → Brand it → Modify it → Make it.` — nằm dưới câu "This cross-linking
   is important because it creates a very clear service ecosystem", một câu rõ
   ràng nói với mình chứ không nói với khách.

Cả hai đọc lên đều **giống copy**. Thứ phân biệt được là **câu đứng trước nó**,
không phải bản thân nó.

`script/check_page_copy` so từng chuỗi trong .docx với copy đã dựng và báo cái nào
thiếu. Nó tìm ra 3 chỗ rơi thật ngay lần chạy đầu: mỗi thẻ vận chuyển của ông có
một câu kết riêng, và cả ba đã bị gộp thành một dòng chung, với chữ nghĩa **tự
chế** để bao được cả ba. Nhìn ảnh render thì ba thẻ trông hoàn toàn bình thường.

Điều cần nhớ: danh sách "ghi chú, không phải copy" trong gate đó là **quyết định
của người đọc**, nên nó nằm ngay trong file kèm lý do. Một dòng bị loại mà không
nói vì sao thì lần sau không ai biết nó bị loại.

## 18 Ảnh chụp fullPage KHÔNG vẽ được iframe khác origin

Trang Book a Meeting và trang Request a Quotation đều nhúng widget của bên thứ ba
(một app đặt lịch và một app form, hai host khác). Cả hai chụp `fullPage: true` ra
**một ô trắng to** đúng chỗ widget.

Widget **không hỏng**. Đo trực tiếp trong phiên đó:

```
frames on the page: [ "<shop>/pages/book-a-meeting",
                      "<booking host>/embed/<account>/<meeting>" ]
inside the calendar frame: "EB <brand> ... Book a meeting with <brand> to discuss pr"
```

Nguyên nhân: Chromium chạy iframe khác origin ở **process riêng** (OOPIF). `fullPage`
đổi kích thước viewport rồi composite lại, và frame ở process khác không vẽ vào lần
capture đó. Chụp **chính element iframe** trong cùng phiên thì ra đầy đủ.

Suýt gửi cho khách một tấm hình chứng minh "trang đã xong" với đúng cái widget của
ông là khoảng trắng.

Hai bẫy nhỏ trong lúc sửa cái này, đều cho ra kết luận sai:

1. Cổng chờ `body *` **attach** trong frame. Cái đó xảy ra ngay khi HTML vỏ được
   parse, trước khi app React vẽ gì. Frame "đã painted" theo định nghĩa đó, nên
   **không có gì đỏ** và ảnh vẫn trắng.
2. Sửa thành chờ regex `\S{20,}` (20 ký tự liền không khoảng trắng). Form báo giá
   của ông **không có** chuỗi nào như vậy: toàn nhãn ngắn cách nhau bằng khoảng
   trắng. Một form vẽ hoàn hảo bị báo là trắng. Phải **đọc độ dài** của innerText,
   đừng khớp mẫu nó.

`script/shot_sections.mjs` giờ chụp thêm một tấm riêng cho mỗi embed, và nói rõ
trong INDEX rằng tấm fullPage không vẽ được nó.

## 19 Cổng báo XANH vì nó tìm chữ "FAIL", còn task thì in chữ "MISMATCH"

`check_shop_runtime` chạy ba rake task trên cả 7 shop rồi quyết định đậu/rớt bằng
cách **grep output** tìm `^\s+(FAIL|[0-9]+ problem)`. Lý do ghi ngay trong file:

```
# Each task prints its own verdict line. Read that rather than the exit
# code: rails swallows abort's status through docker exec in some shells,
# and a verdict line is what a person reads anyway.
```

**Niềm tin đó sai.** Đo ngày 25/8, cùng một câu lệnh qua `docker exec` qua `ssh`:

```
au (mismatch)  exit=1
ca (khớp)      exit=0
```

Exit status sống sót hoàn toàn. Và cái workaround viết cho một vấn đề **không tồn
tại** đã vô hiệu hoá luôn cổng: `store:urls` khi lệch in ra chữ **MISMATCH**, không
phải `FAIL`, không phải `N problem`. Grep không thấy gì → nhánh else → in **xanh**.

Hậu quả đo được:

- **6 trên 7 shop** có `storefront_url` trỏ về host ADMIN của chính mình.
- Nút **Complete Your Order** trong email trả **404**; theo redirect thì ra trang
  đăng nhập admin. Cùng URL đó dùng cho email Payment Link.
- Sáng 25/8 `check_all` in `ok — 21 runtime check(s) across 7 shop(s)`.

Header của chính file đó mô tả đúng lỗi này như lý do nó tồn tại: "Six of seven
held a storefront_url that 301s to /admin".

Ba điều rút ra:

1. **Đừng suy ra ĐẬU từ việc VẮNG chữ báo lỗi.** Cổng giờ đọc exit status, VÀ bắt
   buộc task phải **nói ra là nó đậu**. Task chết trước khi in gì cũng là rớt.
2. **Một workaround phải có phép đo đi kèm.** Câu "rails nuốt exit status" chưa
   từng được đo. Nó đúng một dòng comment và sai một cổng.
3. `store:urls_fix` cũng **chưa từng chạy xong lần nào**: `storefront_url` không
   phải cột, nó là method suy ra từ `preferred_storefront_url` → `allowed_origins`
   → `formatted_url`, nên `update!(storefront_url:)` ném `UnknownAttributeError`.
   File tự nói đã sửa sáu shop bằng nó. Không ai đọc output.

## 20 `ship` build image, `ship` KHÔNG restart container

Cùng ngày, hai lần: sửa một rake task, `script/shop_host ship`, chạy lại task, vẫn
lỗi cũ **ở đúng số dòng cũ**. Container vẫn chạy image nó khởi động cùng, còn tag
đã đi tiếp mà không có nó.

Lúc kiểm thì **6 trên 7 backend** đang chạy image cũ hơn tag của chính chúng ba
tiếng, và image đó đã bị xoá khỏi daemon: không có gì để rollback về, và không có
cách nào dựng lại đúng thứ mà sáu backend đang thực thi.

`script/shop_host status` không nhìn ra được. Giờ nó so `{{.Image}}` của container
với `{{.Id}}` của tag mà container được tạo từ đó, và in **STALE**. Đã chứng minh
nó bật được bằng cách so với một tag khác chắc chắn lệch, chứ không chỉ xem nó im
lặng khi mọi thứ đúng.

Cột `database` trên màn hình đó cũng sai: file estate ghi `<shop>_migrate`, mọi
container đang nối vào `<shop>_shop`. Dump sáu database bằng tên trong file cho ra
**sáu file 0 byte** và stderr bị nuốt. Giờ cột đó hỏi thẳng container.

## 21 File llms sai đường dẫn thì hỏng trong im lặng tuyệt đối

`llms.txt` và `llms-full.txt` nói cho AI crawler biết shop là gì và các trang nằm
ở đâu. Cặp file đang chạy trước 26/8 lấy từ server cũ của khách, dùng dạng URL mà
storefront mới **không phục vụ**. Một trong những URL đầu tiên trả 404 và không ai
thấy suốt nhiều tuần: bản thân file trả 200, đọc lên thì 8 KB văn xuôi hoàn toàn
hợp lý, và **không có gì render nó cả**.

`script/check_llms_urls` gọi từng URL trong cả hai file. Ngay lần chạy đầu trên
bộ file mới ông gửi 26/8 nó tìm ra hai loại lỗi khác hẳn nhau:

1. **Của mình**: 6 URL trên một shop trả 404. Chẩn đoán bằng đo, không đoán:

```
/c/categories/.../minitanka-600ml            200   <- dạng sạch
/nolocal/c/categories/.../minitanka-600ml    404   <- có country, thiếu locale
/nolocal/en/c/categories/.../minitanka-600ml 200   <- có cả hai
```

   Route là `/:country/:locale/...`. Sáu URL đó viết country mà thiếu locale, một
   dạng **chưa từng tồn tại trên shop nào**. Chính file đó dùng dạng sạch 51 lần
   khác. Đo trên cả 5 shop mới dám kết luận là lỗi chính tả trong file chứ không
   phải lỗi route bên mình.

2. **Của khách**: ba tên miền cổng bán buôn cho ba nước — DNS không phân giải, có mặt
   trong file của **mọi** shop. Cổng báo riêng hai loại, vì gộp chung là cách báo
   nhầm người.

Điều đáng nhớ: cổng **không** kiểm URL trên host LIVE mà đổi sang host review.
Host live vẫn chạy nền tảng cũ và sẽ trả 200 cho những trang **không tồn tại**
trên bản mới — đó là kiểu "đậu" tệ nhất có thể.

Và shop đóng thì báo **NOT CHECKED** chứ không báo đậu: nó trả 200 kèm trang đăng
nhập cho mọi địa chỉ, kể cả địa chỉ không có thật, nên status code ở đó không
chứng minh được gì.

## 22 `public` ghi đè robots.txt, và không ai nói ra

`cmd_public` upload **cả thư mục** đã stage. Trong đó có `robots.txt`. Nên cập
nhật một file llms cũng thay luôn chính sách crawler của shop đó.

Ngày 26/8 nó đổi robots.txt của một shop từ `Disallow` sang `Allow` như một tác
dụng phụ của việc cập nhật `llms.txt`, và không có dòng log nào nói ra.

Không nguy hiểm **chừng nào** `cmd_noindex` còn hiệu lực, vì nó thêm
`X-Robots-Tag: noindex, nofollow` vào **mọi** response, và header noindex thắng
một robots.txt dễ dãi. Đo lại sau khi sửa: header có mặt trên `/`, `/products`,
`/c/categories/...`, `/pages/...`, `/policies/...` và cả `/llms.txt`.

Nó **sẽ** nguy hiểm ngay khi ai đó chạy `shop_host indexable` rồi publish. Nên
`cmd_public` giờ tự khẳng định lại noindex ở cuối, trên host tạm, thay vì trông
chờ người ta nhớ thứ tự.

Ghi chú ngược lại một lần nữa: `robots.txt` **phải** cho phép crawl thì crawler
mới đọc được header noindex. `Disallow: /` một mình là cấu hình YẾU hơn, vì URL
vẫn có thể vào index mà không có nội dung.

## 23 rclone + key giới hạn 1 bucket = "AccessDenied", mà key thì hoàn toàn đúng

Khách tạo hai bucket Backblaze B2 và gửi key. `rclone copy` trả:

```
AccessDenied: not entitled
status code: 403
```

Đọc lên thì y hệt **key sai**, và suýt nữa gửi ngược lại bảo ông cấp key khác.

Đo bằng cách ký SigV4 tay, không qua rclone:

```
direct PUT     -> 200
direct GET     -> 200, 17 bytes, identical: True
direct DELETE  -> 204
```

**Key hoàn toàn đúng.** Vấn đề là rclone: mặc định nó kiểm tra bucket có tồn tại
không trước khi ghi, và cái kiểm tra đó là một lời gọi **cấp bucket** mà key
giới hạn-một-bucket không có quyền. Mà giới hạn một bucket lại chính là **cách
cấp key đúng đắn**.

Sửa: `no_check_bucket = true` trong config rclone. Một dòng.

Điều rút ra: khi một công cụ báo lỗi quyền, hỏi thẳng API bằng chữ ký tay trước
khi kết luận về credential. Một lời gọi phụ mà công cụ tự thêm vào trông giống
hệt một credential hỏng, và người trả giá là khách bị bảo đi cấp lại key.

## 24 Không có backup nào cả, và cột database trên màn hình lại sai tên

Đo ngày 26/8 trước khi làm gì: server estate **không có backup dạng nào**. Không
rclone, không script, không cron. Chỉ có mấy file dump lấy tay, nằm **cùng ổ đĩa**
với chính database chúng bảo vệ. Bảy shop sắp go-live trong trạng thái đó.

Hai bucket khách tạo đều **rỗng**, nên cũng không có quy ước sẵn nào để theo.

Cái bẫy suýt lặp lại: file estate ghi database là `<shop>_migrate`, mọi container
thật ra nối vào `<shop>_shop`. Lấy tên từ file đó thì `pg_dump` bắn lỗi ra stderr
bị nuốt và cho ra **file 0 byte**, đã xảy ra một lần hôm 25/8. Nên `backup_b2`
hỏi thẳng postgres danh sách database, không đọc từ file.

Ba tầng chứng minh, vì "đã upload" không phải là "có backup":

1. Dump nào **không đọc ngược lại được** thì không upload. `pg_restore -l` phải
   đếm ra ít nhất một `TABLE DATA`.
2. Kích thước đọc **từ trên bucket**, không phải từ file local.
3. `restore` tải object mới nhất về, phục hồi vào một database **tên khác**, đếm
   số dòng ở 4 bảng và so với shop đang chạy, rồi xoá database đó đi.

Lần chạy thật, phục hồi từ **chính output của cron** chứ không phải từ bản upload
tay: 93 products, 93 orders, 97 variants, 159 prices, khớp từng con số với shop
đang sống.

## 25 Gán biến bằng `$(... | grep ...)` dưới `set -e` thoát trong im lặng, trước cả `die`

`script/shop_host live_host b2b` in đúng một dòng tiêu đề rồi thoát. Không ✓,
không ✗, không một chữ lỗi nào. Sáu shop kia chạy tốt.

Mất một lúc mới ra, vì tôi đi kiểm tra đúng hai thứ mà `die` có thể bắn ra: cột
`S_LIVE` của b2b có giá trị, và certificate của nó dưới `/etc/letsencrypt/live/` có
thật. Cả hai đều ổn, nên tôi kết luận nhầm rằng `die` không hề chạy. Đúng là nó
không chạy, nhưng lý do là script đã chết **trước khi tới được** dòng `die`.

Hai nguyên nhân chồng lên nhau:

**Một, shop đóng cửa không trả về HTML.** b2b là shop có cổng đăng nhập. Trang
chủ của nó trả `307` sang `/account?redirect=%2F`, body **21 byte**, không có
`<title>` nào cả:

```
status=307 size=21 redirect=https://<shop>/account?redirect=%2F
--- first bytes ---
/account?redirect=%2F
```

`curl` không có `-L` thì đọc đúng 21 byte đó. Sáu shop mở thì trả 200 kèm title,
nên chỉ mình shop có cổng vỡ.

**Hai, `grep` không tìm thấy gì thì trả về 1, và file này chạy dưới `set -e`.**

```bash
local title
title=$(printf '%s' "$body" | grep -o '<title>[^<]*' | head -1 | sed 's/<title>//')
[[ -n "$title" ]] || die "..."          # <-- không bao giờ tới đây
```

Dòng `[[ -n "$title" ]] || die` được viết ra chính xác để lo trường hợp này, và
nó vô dụng, vì `set -e` giết script ở dòng ngay trên. Cái bẫy: tách khai báo ra
(`local title` riêng, rồi mới gán) là cách người ta vẫn dùng để **tránh** việc
`local` nuốt mất exit code. Ở đây nó làm ngược lại: nó trả exit code về đúng lúc
`set -e` đang nghe.

Sửa: `|| true` ở cuối câu gán, `-L` cho curl, và khi không có title thì in 300
byte đầu ra màn hình rồi mới `die`.

Điều đáng nhớ không phải là cú pháp bash. Là một công cụ cutover **thoát 0 mà
không nói gì** thì đọc y hệt như thành công, và cái vòng lặp 7 shop hôm đó đã in
sáu dấu ✓ rồi đi tiếp. Nếu tôi không đếm số dấu ✓ so với số shop thì b2b đã lên
sóng với nginx chưa hề khai báo tên miền thật của nó.

## 26 Pipe một lệnh deploy qua `tail` là xoá mất exit code của nó

Ba lần trong một buổi sáng 27/8, và lần thứ ba mới nhìn ra.

```bash
script/shop_host storefront b2b 2>&1 | tail -10
```

Lệnh này in ra:

```
==> Refreshing the storefront source on the server
      storefront/wcheck.mjs

FAILED: the lines above are source this build would leave behind: it sends
`git ls-files`. Run git add on them.

[exited with code 0]
```

**Nó FAIL, và báo exit 0.** Vì trong pipeline, exit code là của lệnh *cuối*, tức
`tail`, và `tail` luôn thành công. Cổng `check_untracked_source` chạy đúng, `die`
đúng, thông báo đúng — chỉ có con số cuối cùng là sai, và con số đó là thứ được
đọc.

Hậu quả cụ thể: tôi tin b2b đã build lại 3 lần, trong khi **không lần nào file lên
tới server**. Chỉ phát hiện khi so checksum `content.ts` local với server và thấy
lệch, rồi mới đọc ngược lên log.

Cái làm nó khó thấy: `push_storefront_source` **có** một guard so checksum từng
file gitignored và `die` nếu lệch. Guard đó không bao giờ chạy, vì lệnh chết ở
bước untracked ngay trước nó. Một guard tốt nằm sau một guard khác thì vô hình khi
guard trước chết.

Nguồn gốc file `wcheck.mjs`: một script browser tạm tôi `cp` vào `storefront/` để
chạy, với `rm -f` ở cuối cùng dòng. Lệnh đó **timeout sau 10 phút**, nên `rm`
không bao giờ chạy. Một file tạm chỉ tự dọn khi lệnh chạy tới cuối.

Ba việc rút ra:

1. Deploy thì **không pipe**. Ghi ra file rồi `tail` file đó:
   `script/deploy ... > /tmp/x.log 2>&1; echo "exit=$?"; tail /tmp/x.log`
2. `${PIPESTATUS[0]}` là cách khác, nhưng phải nhớ, và cái phải nhớ là cái sẽ quên.
3. File tạm đặt trong scratchpad, không đặt trong cây nguồn. Cây nguồn có cổng
   canh chừng nó, và cổng đó sẽ chặn build của người khác.

Cùng buổi sáng còn hai lần nữa cùng họ: `script/check_all | tail -30` chạy 13 phút
không in gì (buffer), và một `python3 -c` viết file credentials bên trong
`$(...)` của zsh bị nuốt mất phần nối chuỗi, ghi ra **file 6 dòng không có
credential nào** và không báo lỗi. File credentials rỗng trong im lặng nguy hiểm
hơn không có file, vì người sau đọc thấy "đã lưu" rồi thôi không tìm nữa.

## 27 `innerText` trả về CHỮ HOA khi CSS `text-transform: uppercase`, và so sánh phân biệt hoa thường báo sai toàn bộ

Chụp footer shop wholesale sau khi gỡ 5 trang đặt nhầm. Check đọc text rồi so:

```js
const body = await p.evaluate(() => document.body.innerText);
body.includes("Book a Meeting")   // false
```

Kết quả: **11/11 dòng đều sai**, kể cả 6 mục lẽ ra phải có:

```
MISSING  Book a Meeting   (should be present)
MISSING  Ordering Guide   (should be present)
...
```

Đọc như thể footer trống rỗng, tức là bản sửa đã phá luôn cả phần đúng.

Footer hoàn toàn đúng. CSS của nó có `text-transform: uppercase`, và `innerText`
(khác `textContent`) trả về text **sau khi đã transform**, nên trong DOM là
`BOOK A MEETING`. `includes("Book a Meeting")` không khớp.

Cái bắt được: **mở tấm ảnh ra nhìn.** Ảnh cho thấy đúng 6 mục, đúng thứ tự.

Điểm đáng nhớ nằm ở chiều ngược với quy tắc quen thuộc ở đây. "Không bao giờ coi
một màn hình là xong khi chưa có ảnh" vẫn được hiểu là ảnh bắt **trang sai**. Lần
này trang đúng và ảnh bắt **cái check sai**. Một check báo hỏng toàn bộ nguy hiểm
ngang một check báo xanh toàn bộ: cả hai đều khiến người ta đi sửa nhầm chỗ, và
cái báo hỏng còn tốn thêm thời gian tháo ra một bản vá vốn đã đúng.

Sửa: đọc `textContent` của từng anchor, hoặc so `toLowerCase()` cả hai phía.

```js
const links = [...document.querySelectorAll("footer a")].map(a => a.textContent.trim());
links.map(s => s.toLowerCase()).includes("book a meeting")   // true
```

Ghi chú về tài khoản dùng để chụp: shop này sau login, không có credential nào lưu
lại, và 4 customer trong đó đều là người thật. Nên tạo **một** tài khoản tạm trên
**bản review** (bản sẽ bị thay bằng dump mới hôm cutover), chụp, rồi xoá. Đếm
trước và sau phải khớp từng con số:

```
BEFORE: users=4 orders=6 products=42
AFTER:  users=4 orders=6 products=42
```

## 28 "File cấu hình có tồn tại không" không phải là một cái guard

Viết `--live` cho `cmd_storefront` để build storefront trên tên miền thật, và đặt
một điều kiện tưởng là chặt:

```bash
rsh "test -f /etc/nginx/sites-available/$site_host" \
  || die "this box does not answer for $site_host yet"
```

Rồi chạy nó trên một shop **để chứng minh nó từ chối**. Nó không từ chối. Nó
build xong, swap container, và review copy bắt đầu khai:

```html
<link rel="canonical" href="https://<tên miền thật của shop>"/>
```

Lý do: **cùng buổi sáng đó tôi đã tạo vhost live cho cả bảy shop**, để box trả lời
được ngay khi một record được trỏ sang. Nên `test -f` đúng với cả bảy và không
chặn cái nào. Điều kiện được viết như một cái khoá, và tại thời điểm chạy nó là
một câu luôn đúng.

Cái tôi làm sai không phải là quên `--force`. Là chọn một điều kiện **không đổi
theo trạng thái mình muốn kiểm**. vhost tồn tại nói lên "nginx sẵn sàng", không
nói lên "shop này đã được chuyển".

Khoá thật phải đọc **trạng thái của chính shop đó**:

```bash
env_store=$(rsh "grep -E '^STORE_URL=' /srv/$S_DIR/.env | cut -d= -f2-")
[[ "$env_store" == "$site_host" ]] || die "this shop has not been cut over yet"
```

`STORE_URL` chỉ mang tên live sau khi `cutover` chạy. Nên không thể build một
shop trên tên thật trước khi nó thực sự được chuyển, bất kể có bao nhiêu vhost.

Ba điều rút ra:

1. Trước khi tin một guard, **chạy nó và xem nó có từ chối thật không**. Tôi có
   làm đúng việc đó, và may là nhờ vậy mới phát hiện. Nếu chỉ đọc code rồi tin
   thì nó sẽ nổ vào ngày cutover.
2. Một điều kiện tham chiếu **hạ tầng dùng chung** (vhost, DNS, thư mục) gần như
   luôn đúng. Điều kiện tốt tham chiếu **trạng thái riêng của đối tượng** đang bị
   thay đổi.
3. Hạ tầng chuẩn bị sẵn cho tương lai sẽ **làm hỏng các guard viết trước đó**.
   `live_host` chạy lúc 09:00 đã âm thầm vô hiệu hoá một guard viết lúc 15:00.

## 29 Đổi tên host admin làm mọi ảnh sản phẩm trả 400, trang vẫn render, không log nào báo

Khách yêu cầu đưa host admin vào Cloudflare. Universal SSL chỉ phủ một cấp
subdomain nên tên ba nhãn không proxy được, phải đổi sang tên hai nhãn. Đổi xong,
`cutover` ghi `RAILS_HOST` thành tên mới.

Shop lên, tiêu đề đúng, canonical đúng, **200 mọi trang**. Browser walk báo:

```
FAIL  no request to this shop errored
      400 /_next/image?url=https%3A%2F%2F<host-admin-MỚI>%2Frails%2Factive_storage%2F…
```

**Mọi ảnh sản phẩm đều 400.** Trang vẫn dựng bình thường, không lỗi ở log Rails,
không lỗi ở log storefront. Shop chỉ đơn giản là không có ảnh nào.

Nguyên nhân: Rails sinh URL Active Storage từ `RAILS_HOST`, đọc **lúc chạy**. Next
bake danh sách `remotePatterns` từ `SPREE_API_URL`, đọc **lúc build**. Hai giá trị
này phải là cùng một host, và `cutover` chỉ đổi được cái thứ nhất. Bản build đang
chạy vẫn chỉ chấp nhận tên cũ, nên optimizer từ chối mọi ảnh trên tên mới.

Điểm nguy hiểm: `_next/image` trả 400 chứ không phải 500, và `<Image>` của Next
nuốt lỗi đó. Không có exception, không có dòng log, không có gì hỏng ngoài việc
ảnh không hiện. Đọc HTML thấy thẻ `<img>` đầy đủ. Chỉ trình duyệt mới thấy.

Sửa: `storefront --live` đọc `RAILS_HOST` thẳng từ `.env` của chính shop đó trên
server, thay vì lấy tên trong `.estate`:

```bash
api_host=$(rsh "grep -E '^RAILS_HOST=' /srv/$S_DIR/.env | cut -d= -f2-")
[[ -n "$api_host" ]] || die "run cutover first"
--build-arg SPREE_API_URL=https://$api_host
```

Quy tắc rút ra: **một giá trị đọc lúc build và một giá trị đọc lúc chạy mà phải
khớp nhau thì không được lấy từ hai nguồn khác nhau.** Lấy cái lúc build từ chính
cái lúc chạy, để chúng không thể lệch.

Và: lần thứ hai trong ngày một cổng bắt được thứ mà đọc HTML không bao giờ thấy.
Lần trước là footer, lần này là ảnh.

## 30 Có Playwright trong tay mà ngồi đếm thay vì chụp ảnh ra nhìn

Khách mở shop vừa chuyển và nhắn: *"frontend is all blank for me"*, kèm ảnh bốn ô
xám có icon ảnh vỡ.

Trước đó **cùng buổi**, tôi đã báo cáo shop đó ổn, dựa trên:

```js
imgs.filter(i => i.complete && i.naturalWidth === 0).length   // = 0
```

Số đó đúng và vô nghĩa. Card **không có thẻ `<img>` nào cả** — nó vẽ ô placeholder
khi không có ảnh. Không có `<img>` thì không có `naturalWidth` để bằng 0, nên phép
đếm trả về "0 ảnh hỏng" trên một trang không có ảnh nào.

Rồi tôi đếm sai thêm ba lần nữa, mỗi lần một cách:

- đếm `naturalWidth > 0` là "loaded", trong khi ảnh **placeholder xám cũng là một
  ảnh hợp lệ** nên được tính là thành công
- đếm request `/_next/image` trả 200, trong khi những request 404 là ảnh hover mà
  khách không nhìn thấy
- đếm blob có file trên đĩa, ra 260/260, trong khi vấn đề không nằm ở file

Bốn phép đo, bốn lần "ổn", một shop không có tấm ảnh nào.

Cái lẽ ra phải làm ngay từ phút đầu, và có sẵn công cụ:

```js
await p.screenshot({ path: "shot.png" });
```

rồi **mở nó ra nhìn**. Đúng câu đã viết trong repo này từ lâu: *không bao giờ coi
một màn hình là xong khi chưa có ảnh*. Hôm nay nó bị bỏ qua vì đếm thì nhanh hơn
và cho ra một con số trông giống bằng chứng.

Nguyên nhân thật, khi tìm ra, nằm ở một dòng SQL trong task của chính mình:

```sql
WHERE ab.service_name <> 'local'   -- coi MỌI ảnh là chưa sang được
```

Không blob nào trên estate này tên service là `local`; tất cả là `mirror` hoặc
`minio`, và `storage.yml` khai cả ba trỏ **cùng một thư mục Disk**. Task xoá sạch
`primary_media_id` của mọi sản phẩm, rồi in ra `160 left blank, no image of theirs
came across` — một dòng log nghe như đã phát hiện điều gì đó, trong khi nó vừa gây
ra điều đó. Nó còn xoá đúng thứ mà task chạy ngay trước nó vừa điền, nên hai dòng
log cạnh nhau đọc như "thành công, kèm ghi chú".

Ba điều rút ra:

1. **Một phép đếm không thay được một tấm ảnh.** Đếm trả lời "bao nhiêu", ảnh trả
   lời "khách thấy gì". Chỉ câu thứ hai mới là câu đang hỏi.
2. Khi một phép đo cho kết quả **trái với điều người dùng vừa nói**, mặc định là
   phép đo sai, không phải người dùng sai. Khách đúng cả hai lần hôm nay.
3. Một cái tên (`service_name`) không bao giờ trả lời được câu hỏi về sự tồn tại
   (`file có ở đây không`). Phải hỏi đúng thứ biết câu trả lời: `service.exist?`.

---

## 8. Ship xong không có nghĩa là đã deploy (27 Aug)

Khách gửi ảnh chụp shop live của ông: một hàng bốn sản phẩm, có tên, có giá, chỗ để
ảnh là bốn ô xám. Bản vá cho đúng lỗi này đã viết, đã ship và đã kiểm từ trước đó.

Đo ra:

```
container   file_present?  image created
shop A_web  3              2026-08-27T11:49:33
shop B_web  0              2026-08-27T09:36:21     <- shop live
shop C_web  0              2026-08-25T16:14:34
shop D_web  0              2026-08-25T16:15:35
shop E_web  0              2026-08-25T16:17:04
shop F_web  0              2026-08-26T08:14:31
```

`file_present?` là số dòng của hàm chỉ có trong bản đã sửa. Hai container có, năm
container không. Lý do đơn giản và đắt:

- `script/shop_host ship` build `spree-estate:latest` trên server rồi **dừng ở đó**.
- Container đang chạy giữ nguyên image ID lúc nó khởi động. Build lại bao nhiêu lần
  cũng không đổi được điều đó.
- Hai container tình cờ được `--force-recreate` bằng tay lúc truy lỗi gốc, nên
  hai cái đó nhận bản vá. Năm cái còn lại thì không.

**Bằng chứng đã nằm sẵn trong output suốt thời gian đó.** Chạy backfill trên
container của shop live in ra `156 left blank, no image of theirs came across`, nguyên
văn câu chữ đã bị xoá khỏi source từ trước. Một dòng log dùng từ ngữ không còn tồn tại
trong code là bằng chứng container đang chạy code cũ, và nó đã bị đọc lướt qua.

Hai thứ được thêm:

- `script/check_containers_current` — so image ID của từng `<shop>_web` với ID mà
  `spree-estate:latest` đang trỏ tới. Nằm trong `check_all`.
- `script/shop_host refresh` — dựng lại cả bảy container lên image vừa build, chờ
  từng cái trả lời `/up`, rồi tự chạy cổng trên.

Và một lần nữa cùng một cái bẫy: `cmd_refresh` viết lần đầu bằng
`while read ... < <(...)` với `ssh` trong thân vòng lặp. `ssh` nuốt hết stdin, vòng
lặp chạy đúng một shop rồi dừng. File `shop_host` **đã có sẵn cảnh báo về chính lỗi
này** trong `cmd_ship`. Cổng vừa viết bắt được ngay: "recreated 1, còn 6 stale".

### 8.1 Bản ghi biến thể sang, file biến thể thì không

Sau khi ảnh đã hiện, `check_storefront_e2e` vẫn đỏ một dòng: vài URL
`_next/image` trả 404. Đo:

```
representations/redirect/<blob>/<variation>   302 -> disk url -> 404
representations/proxy/<blob>/<variation>      404 trong 4ms
blobs/proxy/<blob>                            200          <- ảnh gốc, vẫn tốt
```

Hỏi thẳng app bằng đúng đường mà controller đi:

```
representation built: ActiveStorage::VariantWithRecord
processed ok: u4i9p9n87c0qahdfiup5eqa1tb2b
image present: false
```

`ActiveStorage::VariantRecord` là bản ghi nói "thumbnail này đã sinh rồi". Những
bản ghi đó nằm trong dump. **File đằng sau chúng là dữ liệu dẫn xuất và chưa bao giờ
nằm trong bản mirror ảnh.** Nên `processed` thấy bản ghi, kết luận không cần sinh gì,
và trả về một blob không có file.

Nó không làm trang trắng, nên nó sống sót lâu: Next hỏi nhiều kích thước, kích thước
nào không có bản ghi cũ thì sinh mới và hiện bình thường, chỉ những kích thước trùng
một bản ghi cũ mới hỏng.

Đếm được: 434 trên 2364 bản ghi ở một shop đã chuyển, 15 trên 2416 ở shop kia, và
**0 trên năm shop có biến thể sinh tại chỗ**. Xoá bản ghi là an toàn và là toàn bộ cách
sửa: biến thể dẫn xuất từ ảnh gốc, ảnh gốc vẫn còn. `bin/rails backfill:orphan_variants`,
đã nằm trong `backfill:all`.

### 8.2 Cloudflare giữ bản 404 đã cache, và Next lấy ảnh qua đúng edge đó

Sửa xong ở origin mà e2e vẫn đỏ. Cùng một URL:

```
từ máy tôi (edge HKG):        200  cf-cache-status: HIT  age 186
từ trong container (edge ORD): 404  cf-cache-status: HIT  age 16140
```

Bộ tối ưu ảnh của Next chạy **trên server**, nên nó luôn đi qua edge của server.
Ảnh vẫn hỏng với mọi khách ở mọi nơi, trong khi mở trên máy mình thì thấy tốt.

Đếm trên shop Canada: **10 trên 104 URL ảnh** đang là bản 404 cache ở edge, tuổi từ
1,4 đến 5,8 giờ. Shop kia 124/124 sạch.

Ba điều rút ra:

1. **Kiểm một URL public phải kiểm từ đường mạng mà server dùng**, không phải từ
   laptop. Hai edge khác nhau trả lời khác nhau, và cái quyết định là edge của server.
2. Một bản sửa ở origin không tự dọn được lỗi đã cache ở edge. Sau khi sửa thứ gì
   sinh ra 404, phải purge cache.
3. `cf-cache-status` và `age` là hai header duy nhất phân biệt được "vẫn hỏng" với
   "đã sửa, chỉ là chưa hết cache". Đọc chúng trước khi kết luận.

### 8.3 Nạp lại dump xoá luôn phần đã khắc phục

`collections/on-sale` sang từ dump ở dạng rule-based (`automatic = true`), mà Store
API 5.6 không phục vụ taxon rule-based nào. Task `on_sale:build` đã chạy tay cho hai
shop từ trước. Rồi hai shop đó được nạp lại từ dump mới vào ngày cutover, và bản nạp
đưa collection về đúng trạng thái cũ: rule-based, giữ 1–2 sản phẩm mà rule khớp phải.

Kết quả là trạng thái tệ nhất của cả hai đường:

- `automatic = true` nên trang mà nút "see what's on offer" dẫn tới trống trơn
- có sẵn 1 sản phẩm nên `on_sale:build` thấy "đã có hàng" và không đụng vào, đúng
  như khách đã yêu cầu nó cư xử

Cách sửa không phải `refill` (nó xoá). Thêm `on_sale:top_up`: chuyển taxon sang manual
rồi **chỉ thêm phần thiếu**, không bỏ gì. Hai shop từ 1 và 2 lên 15 và 17 sản phẩm.

Ba chỗ được sửa để không lặp lại:

- `script/migrate_shop` chạy `on_sale:top_up` ngay sau `backfill:all`. Bất cứ thứ gì
  nạp database đều phải chạy lại phần khắc phục sau nó.
- `script/cutover_check` thêm bước 4b, hỏi câu ngược với bước 5: bước 5 hỏi "trang
  chết có redirect sang chỗ sống không", 4b hỏi "chỗ đến có đáng đến không". Hai shop
  đạt full điểm bước 5 trong khi nút on-sale dẫn sang một category nhỏ hơn.
- `retired-urls.json` bỏ redirect đưa `collections/on-sale` đi nơi khác.

### 8.4 Truyền sai country cho e2e thì đọc ra một lỗi không có thật

`check_storefront_e2e.mjs <host> ca en` chạy trên một shop có country key riêng
(tên của chính nó, không phải mã ISO) báo timeout ở `/ca/en/products`. Chạy lại với
đúng key của shop đó: **31 passed, 0 failed**.

Tham số sai sinh ra một lỗi trông rất thật và tốn gần một giờ. Trước khi tin một dòng
đỏ, kiểm lại tham số đã truyền cho chính công cụ đo.

---

## 9. Quy trình chuyển shop, dạng một lệnh (27 Aug)

Hai shop đầu được chuyển bằng cách gõ đúng lệnh, đúng thứ tự, bằng tay. Cả hai lên
live kèm lỗi mà chính những lệnh đó bắt được, vì có bước bị bỏ, có bước chạy trước
bước nó phụ thuộc, và có bước in ra chữ "problem" trong một câu không ai đọc kỹ.

`script/cutover_pipeline <shop>` gom tất cả lại, thứ tự cố định, hỏng là dừng.

```
script/cutover_pipeline <shop>        diễn tập: chạy hết mọi kiểm tra, không đổi gì
script/cutover_pipeline <shop> --go   làm thật
```

Tám bước, và lỗi thật đã sinh ra từng bước:

| Bước | Bắt được gì |
|---|---|
| 1. checkout đủ điều kiện ship | file gitignored app cần mà deploy bỏ lại, từng làm sập backend |
| 2. container đang chạy image mới nhất | năm shop chạy code cũ; task khắc phục chạy trong container cũ **gỡ ngược** bản vá |
| 3. backfill:all rồi on_sale:top_up | đúng thứ tự phụ thuộc, và **sau** mọi lần nạp database |
| 4. database tự trả lời | ảnh thiếu, on-sale còn rule-based, bản ghi biến thể mồ côi, nhóm giao hàng không ai phục vụ |
| 5. cutover, live_host, storefront, restore_payments | shop không nhận được thẻ vì payment method chưa bật lại |
| 6. `cutover_check` | danh sách riêng của từng shop |
| 7. browser thật + ảnh | shop render hoàn hảo, 200 mọi nơi, **không đặt được hàng** |
| 8. widget + reviews | hai thứ ảnh chụp không trả lời được |

Bước 4 là bước rẻ nhất và có giá trị nhất: nó hỏi database sáu câu trước khi một
trình duyệt nào được mở, ở tầng mà lỗi còn sửa được không cần build lại.

Bước 7 không phải tùy chọn. **Mọi lỗi khách tự tìm ra đều nhìn thấy trong một tấm
ảnh và vô hình trong một phép đếm.**

Diễn tập trên shop kế tiếp cho kết quả sạch, 32 passed 0 failed, trước ngày chuyển
chứ không phải sáng hôm chuyển.

### 9.1 Country key truyền cho e2e phải là key của chính shop đó

Một shop có country key riêng là tên của nó chứ không phải mã ISO hai chữ. Truyền
`ca` cho shop đó sinh ra timeout ở `/ca/en/products` trông y như một lỗi thật, tốn
gần một giờ. Pipeline luôn truyền `$SHOP`, nên không còn cách gõ sai.

---

## 10. CSS của khách bị vứt vì thụt đầu dòng bằng non-breaking space (28 Aug)

Khách gửi khối CSS ông đã dán vào một shop và hỏi "check that the script for the
button is correct? The blue colour is wrong". Nút Accept của banner cookie vẫn xanh
dương.

Đo bằng trình duyệt, từng bước, không đoán:

```
nút tồn tại                        true
nằm trong .gdpr-cookie-law          true
selector con của ông khớp           true
thẻ <style> của ông có trên trang   true, và được parse (sheet.cssRules đọc được)
computed background                 rgb(7, 128, 192)   <- vẫn xanh
```

Mọi thứ đều đúng, nhưng màu không đổi. Câu trả lời nằm ở chỗ đọc **nội dung rule đã
parse** chứ không phải chỉ hỏi "rule có ở đó không":

```
.gdpr-cookie-law .gdpr-cookie-law__btn--accept { }
.gdpr-cookie-law .gdpr-cookie-law__btn--accept:hover { }
```

Selector sống sót, **thân rule rỗng**. Nguồn:

```
<style>
.gdpr-cookie-law .gdpr-cookie-law__btn--accept {
  background-color: #E5E8D9 !important;
```

Mỗi khai báo được thụt đầu dòng bằng **U+00A0**, non-breaking space. JavaScript coi
ký tự đó là khoảng trắng hợp lệ, nên toàn bộ đoạn script chatwoot dán cùng kiểu vẫn
chạy hoàn hảo và không ai nghi ngờ gì. CSS thì không: một khai báo có U+00A0 đứng
trước tên thuộc tính là khai báo sai cú pháp, trình duyệt **bỏ khai báo đó và giữ lại
cái vỏ rule**. Không có lỗi nào ở đâu cả, không console, không network.

Sau khi thay U+00A0 bằng dấu cách thường, chỉ trong khối `<style>`:

```
computed background  rgb(229, 232, 217)   = #E5E8D9
rule thắng           .gdpr-cookie-law .gdpr-cookie-law__btn--accept  important
```

Ba điều rút ra:

1. **"Rule có trên trang" và "rule có tác dụng" là hai câu hỏi khác nhau.** Bốn phép
   đo đầu đều trả lời "có" và đều không phải câu đang cần. Câu đúng là đọc
   `sheet.cssRules[i].cssText` ra xem thân nó còn gì.
2. Ký tự vô hình đi kèm mọi thứ dán từ trình soạn thảo hoặc từ chat. Khi CSS "đúng mà
   không ăn", nghi ngờ ký tự trước, đừng nghi specificity.
3. Cùng một ký tự đó nằm trong JavaScript ngay bên trên và **không gây lỗi gì**, nên
   sự có mặt của nó ở chỗ khác không phải bằng chứng nó vô hại.

---

## 11. Ngày chuyển bốn shop, và bốn lần phép đo báo oan shop tốt (28 Aug)

Bốn shop chuyển trong một ngày bằng `script/cutover_pipeline`. Không shop nào hỏng.
**Bốn lần cổng kiểm báo đỏ, và cả bốn lần lỗi nằm ở phép đo.** Đây là ghi chép về
bốn lần đó, vì mỗi lần đều mất thời gian và một lần suýt thành tin nhắn sai gửi khách.

### 11.1 `sed 's#^https\?://##'` không chạy trên macOS

BSD sed không hiểu `\?` là lượng từ tuỳ chọn. Scheme bị cắt một nửa, browser walk
được trỏ tới `https://https//<host>/...`, và lỗi điều hướng đó in ra thành **"the
browser walk failed"** trên một shop đang phục vụ hoàn hảo. Script này chạy trên Mac
nên phải dùng `https*://`.

### 11.2 `networkidle` không bao giờ đến trên shop có script bên thứ ba

Chat widget, pixel social proof và hai script analytics giữ kết nối mở suốt thời gian
trang hiển thị. `waitUntil: "networkidle"` hết 90 giây, rồi thao tác cuộn sau đó đua
với hydration và ném ra

```
page.evaluate: Execution context was destroyed, most likely because of a navigation
```

mà caller in thành **"product photographs did not render"**. Shop có đủ 42 ảnh.
Đổi sang `domcontentloaded` và dùng `mouse.wheel` thay `evaluate(scrollBy)`, vì sự
kiện chuột không bị huỷ khi trang điều hướng bên dưới.

### 11.3 Gộp "ảnh hỏng" với "ảnh đang tải"

Phép đếm cũ chỉ có hai trạng thái: decoded, và không-decoded. Nó báo **"2 of 42
photographs did not render"** trên shop mà trình duyệt ghi nhận **0 request 4xx** và
server lấy được **36/36** URL. Con số còn đổi mỗi lần chạy: 30, rồi 34, rồi 40.

Ba trạng thái, không phải hai:

| | |
|---|---|
| `complete && naturalWidth > 1` | khách nhìn thấy ảnh |
| `complete && naturalWidth <= 1` | **hỏng thật**, đây mới là lỗi |
| `!complete` | còn trên đường truyền |

Chỉ trạng thái giữa mới fail. Trạng thái cuối in thành ghi chú kèm số lượng, để nó
không bị nuốt thành "pass" một cách im lặng.

### 11.4 Suýt báo khách "shop sỉ không bán được hàng"

Cổng `check_gated_can_sell.mjs` vừa viết xong chạy lần đầu và in:

```
FAIL  clicked add to cart and the basket is still empty. This shop cannot sell.
```

Đó đúng là câu đắt nhất trong dự án này. Nhưng bắt request lúc bấm cho thấy:

```
POST 200 /products/600ml-minitanka-with-screwtop-lid-full-carton
số trên giỏ:  8  ->  9
```

Server nhận, giỏ tăng. Shop bán được. Cổng sai vì nó đọc trang `/cart`, mà storefront
này hiển thị giỏ bằng **drawer** chứ không phải trang: `/cart` render vỏ shop, không
có dòng hàng nào trong markup, nên "không có dòng nào" bị đọc thành "giỏ rỗng".

Viết lại để phán xét bằng hai thứ khách thực sự trải nghiệm: **server có nhận POST
không**, và **số trên giỏ có tăng không**. Chạy lại: `9 -> 10`.

Bài học: một cổng mới, lần chạy đầu tiên, ra kết quả thảm khốc, thì **nghi cổng
trước khi nghi shop**. Ba trong bốn ca hôm nay có hình đó.

### 11.5 Cái cổng bắt được lỗi thật

Trong cùng ngày đó, các cổng bắt đúng ba lỗi thật, không cái nào nhìn thấy được từ
việc mở trang:

- **nz**: `categories/shop-specials/on-sale/special-offers` là rule-based với 12 sản
  phẩm. API 5.6 không phục vụ taxon rule-based, nên trang đó trống. Trên hai shop
  khác cùng permalink lại là manual, nên đây là điều kiện riêng từng shop.
- **b2b**: mã đơn trong `.env` là `ENZW`, trong khi **5 đơn thật của khách đều mang
  `EUS`**, còn đơn `ENZW` duy nhất là đơn test của chính mình ngày 21/08. Mình đã đổi
  tiền tố mã đơn của shop sỉ mà không nhận ra. Khách trích số đơn theo tiền tố đó.
- **b2b**: shop có login, nên browser walk chỉ chứng minh cổng đóng, không chứng minh
  bán được. Xem 11.4.

---

## 12. Hostname API sau cutover, và một shop đăng nhập không được (28 Aug)

Khách nhắn: **"login has faild"** trên shop bán sỉ, kèm ảnh màn hình đăng nhập với chữ đỏ
`fetch failed` ngay trên ô email. Catalogue của shop đó vẫn hiện đủ 12 sản phẩm.

Đo từ trong container storefront:

```
storefront gọi   https://store.<shop>.<zone>   -> 000
API thật         https://<shop>-store.<zone>   -> 401 (sống)
dig store.<shop>.<zone>                        -> NXDOMAIN
```

Grep bundle đã build ra thấy **cả hai tên**: 242 lần tên đúng, 216 lần tên chết.
Đường lấy sản phẩm dùng tên đúng nên trang chạy, đường đăng nhập dùng tên chết nên
`fetch failed`. Không log nào ghi gì.

Nguồn gốc trong `cmd_storefront`:

```bash
local api_host="$S_STORE"          # cột .estate, tên trước cutover
...
if [[ live ]]; then
  api_host="$(... RAILS_HOST ...)" # đúng, nhưng CHỈ gán cho biến này
fi
...
taxon_public_id "$S_STORE" ...     # <- vẫn hỏi tên cũ
SPREE_API_URL: https://$S_STORE    # <- vẫn ghi tên cũ
```

Biến `api_host` được sửa cho đúng, rồi **hai chỗ khác vẫn dùng thẳng `$S_STORE`**.
Trước cutover hai giá trị đó bằng nhau nên không ai thấy; sau cutover chúng khác
nhau và tên cũ mất DNS.

Cổng liên khoá collection thậm chí còn từ chối build lại: nó hỏi tên chết, nhận về 0
collection, và báo *"asked for 2 collection(s) and returned 0"* trên một shop hoàn
toàn bình thường. Cổng đúng, câu hỏi sai địa chỉ.

### 12.1 Bốn shop khác mang cùng quả mìn, và nó ĐANG nổ

Sau khi sửa, quét cả bảy:

| | tên cũ xuất hiện trong bundle | trong chunk runtime |
|---|---|---|
| bốn shop | 33 đến 153 file | **0** |
| ba shop còn lại | 0 | 0 |

Tên cũ của cả năm shop đều đã **NXDOMAIN**. Từ hai con số đó tôi kết luận: chỗ nhắc
tên chết chỉ là **file prerender tĩnh** của dạng URL `/country/locale/...`, dạng đó
nay 308 về path sạch, không có dòng code chạy nào gọi nó, nên **không cần build lại**.

**Kết luận đó sai, và bốn shop đang hỏng ngay lúc tôi viết nó.**

Cổng `check_llms_urls`, vừa được sửa để hỏi tên thật thay vì tên tạm, in ra hàng loạt
`ours 500`. Đo trực tiếp:

```
shop      /contact  /pages/about  /policies/returns
bốn shop  500       500           500
hai shop  200       200           200      <- hai shop vừa build lại trong giờ trước
```

Log của storefront nói thẳng:

```
TypeError: fetch failed
  [cause]: Error: getaddrinfo ENOTFOUND store.<shop>.<zone>
StorefrontLayout: failed to load categories
```

Layout gọi API lúc render **mọi** trang nội dung. Trang chủ và trang sản phẩm sống
vì chúng được phục vụ từ prerender còn hạn, nên `check_storefront_e2e` vẫn 31/31 và
tôi đọc đó là "shop khoẻ".

Sai ở đâu: `grep -rl` trong `/app/.next/server/chunks` là **phép đo sai câu hỏi**.
Giá trị được inline vào chính các artifact của route, và server dùng chúng lúc phục
vụ. "Không nằm trong chunk" không có nghĩa là "không được dùng".

Câu hỏi đúng không phải *"chuỗi này nằm ở file loại nào"* mà là **"mở trang đó lên
thì nó trả về gì"**. Một lệnh `curl` tới `/contact` trả lời trong một giây, và tôi đã
dùng hai phép grep để suy ra điều ngược lại.

Build lại cả bốn: mọi trang về 200.

**Đoạn này ban đầu được viết với kết luận ngược lại, kèm câu "không đụng vào cái đang
chạy được".** Câu đó đúng như một nguyên tắc và sai ở đây, vì bốn shop đó không đang
chạy được. Một bài học sai nằm trong file này còn tệ hơn không có bài học nào, nên nó
được viết lại nguyên văn chứ không xoá đi.

### 12.2 Thứ tự đúng khi đổi hostname backend

Khách hỏi trước khi bấm lưu bản ghi DNS. Thứ tự đã dùng:

1. **Dựng vhost trên box trước**, mượn chứng chỉ của tên tạm bên cạnh
2. Chứng minh box trả lời cho tên đó: `curl -H 'Host: <tên>' https://127.0.0.1/up` -> 200
3. Lúc đó mới bảo khách lưu

Ngược lại thì có vài phút tên đã trỏ về đây mà không gì trả lời. Chứng chỉ mượn tên
chạy được vì Cloudflare của khách để **Full**, không phải Full (strict) — và điều đó
được **chứng minh** chứ không đoán: một shop khác đang proxied bình thường trong khi
origin trình chứng chỉ mang tên khác hẳn.

---

## 13. Bộ kiểm tra sức khoẻ, và những gì mười vòng chạy tìm ra (28 Aug)

`script/health` gộp mọi câu hỏi mà từng có lần không ai hỏi:

```
script/health              cả estate, có browser và quét ảnh
script/health <shop>       một shop
script/health --quick      bỏ browser, đủ nhanh để chạy vài phút một lần
script/health --explain    từng mục kiểm để làm gì, và lỗi nào sinh ra nó
```

Chạy nó **mười vòng** không phải để yên tâm mà để tìm cái chập chờn. Nó tìm được hai
thứ, và **cả hai đều nằm trong chính bộ kiểm tra**, không phải trong shop.

### 13.1 `200000` không phải mã HTTP

Vòng 3 in ra:

```
FAIL  content pages do not answer: /c/collections/on-sale=200000
```

Hàm đo viết là:

```bash
code() { curl -s -w '%{http_code}' -L ... || echo 000; }
```

Khi curl in ra `200` cho một chặng của chuỗi redirect **rồi mới** đứt, phần fallback
`000` được **nối thêm** vào cái đã in. Kết quả là một chuỗi không phải mã nào cả, và
một cú chớp mạng thành một dòng đỏ về shop.

Viết lại: bắt output vào biến, chỉ chấp nhận đúng ba chữ số, và **thử lại một lần**
trước khi kết luận. Một kết nối rớt không phải tin tức về shop; hai lần liên tiếp thì
mới là.

Cùng cái bẫy ở chỗ đọc `<title>`: một lần rớt là "shop không có title".

### 13.2 Trang trống của shop đóng bị đếm là khoẻ

Shop bán sỉ có login. Bộ đếm ảnh chạy như khách vãng lai, gặp form đăng nhập, và in:

```
product photographs: 0, decoded 0
ok    no products on this page to judge
```

**Một shop được báo khoẻ dựa trên một trang không có gì trên đó.** Đúng hình dạng của
mọi lỗi trong dự án này.

Với shop đóng phải hỏi hai câu khác: *cổng còn đóng với người lạ không*, và *người đã
đăng nhập có mua được không*. Cả hai đều đã có script; giờ `health` gọi đúng chúng.

Kéo theo một lỗi cùng họ: `check_image_origin` quét shop đóng cũng thấy 0 URL ảnh và
kết luận **"not one image URL on this shop, that is the blank-thumbnail fault"** trên
một shop có đủ ảnh cho 37 sản phẩm. Đã cho phần quét đăng nhập trước khi quét; đo lại
ra **72/72**.

### 13.3 Hai đường im lặng khác, tìm bằng cách đọc lại chính nó

Không phải phát hiện lúc chạy, mà lúc ngồi soi lại file:

- Nếu `ssh` đứt, mọi shop báo "container is not running" và "could not read the
  database" — bảy dòng đỏ về một estate khoẻ. Giờ kiểm kết nối ba lần **trước**, và
  thoát với thông báo rằng đây là mạng chứ không phải shop.
- Nếu runner trả về rỗng, bốn mục kiểm (mail, SMTP, cổng thanh toán, mã đơn) bị **bỏ
  qua trong im lặng**, nên một shop mà Rails không boot được vẫn có bảng điểm sạch vì
  không ai hỏi nó. Giờ nó nói ra.

Điều rút ra chung: **một mục kiểm không chạy được phải kêu to hơn một mục kiểm thất
bại**, vì mục thất bại thì ai cũng thấy, còn mục không chạy thì trông y hệt mục đã
qua.

### 13.4 Sửa file trong lúc job nền đang chạy nó

Vòng 1 in ra `script/health: line 322: syntax error near unexpected token '('`,
trong khi `bash -n` trên cùng file ngay sau đó sạch. Bash đọc script dần dần trong
lúc chạy, nên sửa file giữa chừng làm tiến trình đang chạy đọc phải nửa cũ nửa mới.
Không phải lỗi code. Nếu định sửa, dừng vòng lặp trước.

---

## 14. Middleware đúng nhưng nằm sai toà nhà (29 Aug)

Khách nhắn: *"Checking AI Readiness, looks like the MarkdownNegotiation file now
needs to be done from Next.js"*. Ông chẩn đoán đúng, và đó là loại lỗi khó thấy
nhất: **không có gì hỏng cả**.

Quy tắc là: ai gửi `Accept: text/markdown` thì nhận trang dưới dạng Markdown, đi
cùng `llms.txt` và `robots.txt` viết cho crawler AI. Nó là Rack middleware, và nó
chỉ viết lại response có `Content-Type: text/html`.

Trên 5.6 Rails không phục vụ trang shop nào nữa. Middleware vì thế **không còn gì
để tác động**. Nó không lỗi, không log, chỉ đơn giản là ngừng áp dụng — và sống
như thế qua bảy lần cutover. Chính comment trong file đã ghi trước điều này từ lâu:
"trên 5.6 nó bất động **theo thiết kế**". Không ai đọc lại dòng đó.

Đo trước khi làm:

```
Accept: text/markdown -> storefront   text/html        <- crawler vào đây
Accept: text/markdown -> host Rails   text/markdown    <- middleware sống ở đây
```

### 14.1 Bốn cái bẫy khi chuyển sang Next, ba cái chỉ lộ ra khi chạy thật

**Cờ `/m` của Ruby không phải `/m` của JavaScript.** Ruby `/m` = dấu chấm khớp cả
xuống dòng. JavaScript `/m` = `^` và `$` khớp ở đầu dòng, còn dấu chấm **vẫn không**
khớp xuống dòng. Dịch nguyên cờ sang thì code biên dịch được, chạy được, và **âm
thầm bỏ qua mọi thẻ có xuống dòng bên trong** — trên một trang đã render thì đó là
hầu hết. Tương đương đúng là `/s`, mà target TypeScript của dự án là ES2017 nên
không có. Viết `[\s\S]` thay cho dấu chấm: không cần cờ nào, và cũng không thể bị
ai sao chép sang chỗ khác rồi làm hỏng.

**`export const dynamic` bị `cacheComponents` từ chối.** Build đổ với "Ecmascript
file had an error" trỏ vào dòng export, không nói vì sao. Route handler có đọc
request thì vốn đã động, bỏ dòng đó đi là xong.

**Self-fetch đi vòng ra Cloudflare.** Handler lấy `request.nextUrl.origin`, tức tên
công khai, nên nó rời khỏi máy, qua Cloudflare, quay lại nginx rồi mới tới chính
tiến trình vừa gọi. Cloudflare trả **502** trong khi cùng request đó gọi thẳng vào
container trả **200** — và đó là cách phát hiện. Trang chỉ cách một bước trên
loopback, đi bước đó. Phải kèm header `Host` gốc, vì storefront render theo host.

**`&#x27;` không được giải mã.** Danh sách entity của Ruby có `&#39;` dạng thập
phân, còn React phát ra dạng hex. Port y nguyên thì **mọi dấu nháy đơn trên mọi
trang** đến tay crawler dưới dạng `&#x27;`. Chỉ lộ ra khi đọc kết quả thật của shop
live, không lộ ra khi đọc bản port.

### 14.2 Trả lời một request Markdown trên shop đóng

Bản đầu trả **200 với thân rỗng**: không rò rỉ gì, nhưng nói với crawler rằng trang
tồn tại và trống, thay vì nói rằng trang cần tài khoản. Nguyên nhân là handler tự
`follow` cái 307 về trang đăng nhập, rồi chuyển trang đăng nhập thành Markdown, mà
sau khi bỏ header/footer/nav thì nó không còn chữ nào.

Sửa: `redirect: "manual"`, và trả cái 3xx đó về cho người gọi. Giờ hai đại diện trả
lời như nhau. Một khác biệt nhỏ còn lại và được ghi lại chứ không giấu: tham số
`?redirect=` của bản Markdown trỏ về `/` thay vì trang đã hỏi, vì cổng tính đích từ
đường dẫn nội bộ.

### 14.3 Cổng kiểm phải hỏi "hai bên có khớp nhau không", không phải "có markdown không"

Bản đầu của `check_markdown_negotiation` đòi `text/markdown` và **đánh trượt shop
đóng**, nơi người lạ bị đá về đăng nhập một cách hoàn toàn đúng đắn. Đúng cùng một
hình với phép đếm ảnh đọc trang đăng nhập rồi báo "0 ảnh": một cổng không biết shop
đang đóng sẽ gọi hành vi đúng của nó là lỗi.

Quy tắc đúng là **hai đại diện phải đồng ý với nhau**: HTML chuyển hướng thì Markdown
cũng phải chuyển hướng; HTML trả 200 text/html thì Markdown phải trả 200
text/markdown. Quy tắc đó đúng cho cả hai loại shop và không cần biết shop nào đóng.

---

## 15. `curl ... || echo 000` nối chuỗi chứ không thay thế (29 Aug, lần thứ ba)

Ba cổng kiểm khác nhau trên dự án này đã in ra một dòng đỏ về shop khoẻ vì cùng một
dòng lệnh:

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo 000)
```

curl **in mã nó đã có trước khi nó thất bại**. Nên khi kết nối chập giữa chừng, nó
đã kịp in `200`, rồi nhánh `|| echo 000` in thêm `000` vào cùng biến đó. Kết quả là
`200000`, không khớp nhánh `case` nào, rơi vào `*)` và bị tính là lỗi.

Nó không tái hiện được. Chạy lại là xanh, nên rất dễ kết luận nhầm là shop chập chờn
chứ không phải phép đo chập chờn. Ba lần đã gặp:

| | |
|---|---|
| `script/health` | `/c/collections/on-sale=200000` |
| `script/check_content_pages` | `/policies/shipping=200000` |
| `script/check_social_image` | mô tả rỗng vì một lần fetch lỡ, hai lần chạy liên tiếp cho hai kết quả |

Cách viết đúng, và lý do phải tách làm hai bước:

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" 2>/dev/null)
if ! [[ "$code" =~ ^[0-9]{3}$ ]]; then
  sleep 2
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 40 "$url" 2>/dev/null)
  [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
fi
```

Hai điều rút ra, và điều thứ hai mới là điều đắt:

1. **Hỏi curl mã trả về, rồi hỏi riêng xem curl có chạy xong không.** Gộp hai câu
   hỏi vào một biểu thức là chỗ sinh ra chuỗi rác.
2. **Một câu trả lời không hợp lệ phải được hỏi lại trước khi tin.** Không phải để
   nới lỏng cổng, mà vì "không đọc được" và "đọc được và sai" là hai phát hiện khác
   nhau, và gộp chúng vào một dòng đỏ khiến người đọc đi sửa nhầm thứ. Mọi báo động
   giả trên dự án này đều tốn nhiều thời gian hơn cái lỗi mà nó tuyên bố.

### Lần thứ tư, 30 Aug, trong `check_llms_urls`

```
ours  200000  /c/categories/.../lids-parts/stainless-steel-lids
```

Hỏi tay thì địa chỉ đó trả **200 trên cả năm shop**. Một cổng đỏ, một kết luận
sai, và lần này nó là dòng đỏ duy nhất còn lại trong cả bộ sau một ngày sửa.

Bốn script, bốn lần, cùng một hình dạng. Nên cách viết đúng được đặt thành một
hàm có tên trong chính file đó, thay vì lặp lại lời cảnh báo lần thứ tư:

```bash
status_of() {
  local url="$1" code
  code=$(curl -sS -o /dev/null -L --max-time 45 -w '%{http_code}' "$url" 2>/dev/null)
  if [[ -z "$code" ]] || ! [[ "$code" =~ ^[0-9]{3}$ ]]; then
    sleep 2
    code=$(curl -sS -o /dev/null -L --max-time 60 -w '%{http_code}' "$url" 2>/dev/null)
    [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
  fi
  printf '%s' "$code"
}
```

## 16. Đếm số dòng không nhìn thấy một cú tráo, và so theo tên báo oan mất dữ liệu (30 Aug)

Ổng báo shop nz mất đơn từ 10/08. Đúng: 19 đơn nằm lại trên server ổng, vì bản
dump dùng để cutover được lấy trước ngày đó. Nạp lại từ dump mới là một lệnh
restore, tức là **thay toàn bộ**, nên câu hỏi tiếp theo không phải "19 đơn về
chưa" mà là "có gì khác đã đi mất không".

Câu hỏi đó bị trả lời sai hai lần liên tiếp, theo hai kiểu khác nhau.

### Lần sai thứ nhất: đếm số dòng

So số dòng 16 bảng trước và sau. Mọi bảng đều tăng, đúng một bảng giảm:

```
spree_products_taxons   794 -> 791   -3
```

Kết luận rút ra: mất 3 gán danh mục. **Sai.** Đếm không phân biệt được "mất 3"
với "mất 42, thêm 39". Sự thật khi so theo khoá:

```
776 -> 815 cặp sản phẩm↔danh mục:  thêm 39, mất 3
```

39 cái thêm là sản phẩm ổng tự nhân bản trên server ổng (`COPY OF ECO-022/ST`,
`ECO-022/STCANCELED`) mang theo toàn bộ danh mục của chúng. Một bảng mất 4 dòng
và thêm 4 dòng thì phép đếm bảo là không đổi, còn 4 dòng kia vẫn đi mất.

### Lần sai thứ hai: so theo tên

Ba cái mất được truy bằng cách so **tên sản phẩm** hai bên. Ra ba tên. Hai trong
ba:

```
truoc:  2.0L Stainless Steel <san pham> with 2 Lids [CLEARANCE]
sau:    <thuong hieu> 2L Stainless Steel <san pham> – 2 Interchangeable Lids [CLEARANCE]
```

Ổng đổi tên chúng trên server ổng. Sản phẩm còn nguyên. So lại theo SKU thì chỉ
còn một cái thật, và cái đó là do ổng bỏ khuyến mãi nên rời danh mục on-sale.

Đây đúng là lỗi đã ghi ở mục 11: hai thứ khác nhau đem so với nhau rồi đọc thành
"dữ liệu bị sửa". Lần đó là taxon, lần này là tên sản phẩm. Khoá để so phải là
thứ **không đổi**: SKU cho sản phẩm, số đơn cho đơn hàng. Không bao giờ là tên,
và cũng không phải id khi hai bên khác phiên bản schema.

### Mốc so sánh đúng không phải "database của mình lúc trước"

Cả hai lần sai đều lấy mốc là database của mình *sau khi mình đã can thiệp*. Mốc
đó vô dụng, vì giữa hai lần chụp thì ổng cũng sửa shop hàng ngày, nên khác biệt
lẫn lộn cả việc của ổng lẫn việc của mình.

Mốc đúng là **dump gốc của ổng, nạp nguyên vẹn thành một database thứ ba**. Khi
đó bên trái không có ai sửa gì, nên mọi khác biệt đều là do mình. Làm vậy với nz
thì bảy mặt giống hệt từng dòng, gồm cả 398 đơn hoàn tất và toàn bộ giá, và chỉ
còn đúng hai chỗ lệch, cả hai đều là việc mình cố ý làm.

`script/reconcile_shop` hỏi câu thứ nhất (dòng nào đi mất), `script/reconcile_content`
hỏi câu thứ hai (nội dung nào bị đổi). Cái thứ hai chỉ có nghĩa khi bên trái là
dump gốc.

### Cái mà cả hai đều cố tình không hỏi

Nội dung của một dòng có mặt ở cả hai bên. Ổng sửa shop mỗi ngày, nên báo những
cái đó ra sẽ chôn vùi phát hiện thật dưới hàng trăm cái không phải lỗi.

---

## 17. `make_manual` lật cờ trước khi tính, và đóng băng ảnh chụp cũ vĩnh viễn (30 Aug)

Spree 5.6 không phục vụ taxon `automatic = true` qua Store API (mục 3). Cách chữa
ở đây là `taxons:make_manual`, lật cờ sang thủ công và giữ nguyên sản phẩm đang
có. Nó có một lỗi thứ tự không nhìn thấy được từ bên ngoài.

Bảng phân loại của một taxon tự động **không phải** là câu trả lời của quy tắc.
Spree chỉ làm mới nó khi `Taxons::RegenerateProducts` chạy, nên với một database
phục hồi từ server khách, nó giữ kết quả lần cuối server *của khách* chạy job đó,
vào lúc nào không ai biết.

Và cả hai cửa vào của Spree đều đóng lại ngay khi cờ đã lật:

```ruby
def products_matching_rules(opts = {})
  return Spree::Product.none if manual? || rules.empty?

def call(taxon:)
  return if taxon.manual?
```

Nên lật trước thì ảnh chụp cũ kẹt lại **vĩnh viễn**, và không lệnh nào gỡ ra được
nữa. Đo trên nz:

```
categories/shop-specials/on-sale/special-offers   giu 10
quy tac cua chinh no, ap dung                     khop 28
```

Trang khuyến mãi thiếu 18 sản phẩm đang giảm giá. Không có gì hỏng: trang render,
trả 200, hiện mười sản phẩm thật. Chỉ có cách hỏi quy tắc xem nó *định* nói gì
mới thấy.

Thứ tự đúng là **tính rồi mới đóng băng**, không bao giờ ngược lại.

### Quy tắc của ổng, đọc từ dump chứ không đoán

```
special-offers      : Sale = true  VA  Tag != "combo deal"   (khop tat ca)
collections/on-sale : Sale = true  VA  Tag != "combo deal"   (khop tat ca)
```

Hai danh mục **dùng chung một quy tắc**, nên hai con số khác nhau thì ít nhất một
cái sai. Và vế loại trừ thẻ `combo deal` là thứ `on_sale:top_up` không hề xét, nên
nó đã nhét 10 sản phẩm combo vào `collections/on-sale` trong khi quy tắc của ổng
loại chúng ra (ổng có danh mục `combo-deals` riêng cho chúng).

`Spree::TaxonRules::Sale` gọi scope `on_sale`, và scope đó là:

```ruby
where.not(spree_prices: { compare_at_amount: [nil, 0] }).
  where("compare_at_amount > amount")
```

Nghĩa là sản phẩm `[CLEARANCE]` được hạ giá thẳng, không đặt giá gạch ngang, thì
**không khớp** quy tắc. Áp dụng quy tắc một cách máy móc sẽ gỡ chúng khỏi trang
khuyến mãi, tức là giấu hàng thanh lý khỏi khách. Đó là quyết định bán hàng của
ổng chứ không phải của mình, nên chỗ này dừng lại và hỏi, không tự sửa.

`taxons:sync_to_rules` tính bằng chính các đối tượng quy tắc của Spree, mặc định
chỉ in ra chứ không ghi, và **từ chối** áp dụng khi quy tắc khớp 0 sản phẩm: làm
rỗng một danh mục đang sống thì tệ hơn là để nó cũ.

---

## 18. Một sản phẩm nằm sai nhóm giao hàng thì không ai mua được, và không chỗ nào báo (30 Aug)

Khi so dump gốc của ổng với bản đang chạy, chỉ đúng một sản phẩm khác nhóm giao
hàng, do chính mình đổi lúc chạy pipeline:

```
ECO-022/ST    cua ong: Digital     hien tai: Physical
```

Đổi dữ liệu của khách thì phải chứng minh được là đúng. Đo ba câu:

```
hai phuong thuc giao hang phuc vu nhom nao   Free Post -> Physical
                                             Standard Postage -> Physical
san pham nao o nhom Digital                  dung 1: ECO-022/ST
ECO-022/ST da ban duoc bao nhieu don          0
```

Sản phẩm đó là một cái bình nước thép, nằm ở
nhóm giao hàng mà **không phương thức nào phục vụ**. Khách bỏ nó vào giỏ thì
không có báo giá vận chuyển nào hiện ra, tức là không đặt hàng nổi. Chưa bán được
đơn nào trong một shop đã có 398 đơn chính là dấu vân tay của lỗi đó, không phải
trùng hợp.

Không cổng kiểm tra nào bắt được: trang sản phẩm render, ảnh hiện, giá đúng, API
trả 200. `check_storefront_e2e` bỏ vào giỏ **một** sản phẩm, và nó chọn sản phẩm
đầu tiên trên trang chứ không phải cái này.

Bài học không phải "kiểm tra nhóm giao hàng". Là: một sản phẩm không bán được đơn
nào trong khi cả shop bán được thì đó là một phép đo, và nó đáng để hỏi tại sao.

## 19. Nạp lại database sinh khoá API mới, và giết chết storefront đã build cho nó (30 Aug)

Khoá publishable là thứ **máy sinh ra**, không phải thứ khách cấu hình. Phục hồi
database một shop từ dump của khách sẽ chạy lại bộ nâng cấp, và bộ nâng cấp
**đúc một khoá mới**. Storefront thì nướng khoá vào lúc build.

Nên ngay giây phút nạp lại database, storefront được build cho nó đang cầm một
khoá không còn tồn tại. Đo trên au, hai mươi phút sau khi báo "đã cutover xong":

```
database    pk_xPqjRHrvkuMZW   tao 2026-08-30, do bo nang cap
storefront  pk_rPxvzdvExQcjX   nuong 2026-08-14
```

```
au_storefront log:  Error [SpreeError]: Valid API key required
                    code: 'invalid_token', status: 401
                    StorefrontLayout: failed to load categories
```

Mọi trang render đúng cái vỏ và không có gì bên trong. Trang chủ trả **200** với
0 phần tử header, 0 hàng sản phẩm, 0 ảnh, vì dự án này build với `cacheComponents`
và một trang không nhận được dữ liệu vẫn trả 200.

Không thứ gì trong hệ thống nhìn thấy. `script/health` xanh, cổng kiểm tra trang
nội dung xanh. Chỉ browser walk bắt được, và chỉ vì nó **đếm phần tử** chứ không
đọc mã trạng thái.

nz đi qua đúng quy trình đó cùng buổi sáng và không sao, vì pipeline của nz có
bước build lại storefront. au thì mình nạp lại bằng tay nên thiếu bước đó.

**Build lại là một phần của việc nạp lại, không phải một việc vặt riêng.**
`script/check_storefront_key` hỏi đúng một câu này, bằng một truy vấn và một
`printenv`, nên chạy được trước cả khi mở trình duyệt.

---

## 20. So sánh bằng khoá không duy nhất thì tự đẻ ra khác biệt không có thật (30 Aug)

`script/reconcile_content` ghép hai bên bằng `join` trên cột đầu. `join` ghép
**mọi dòng trái với mọi dòng phải** cùng khoá, nên một khoá lặp lại sinh ra tích
Descartes, và mọi cặp chéo không giống nhau bị báo là khác biệt.

Lần đầu chĩa vào au, nó báo **11 giá khác nhau**. Một SKU mang ba dòng giá:

```
ECO-044/SP   cua ong 0.00    hien tai 35.00
ECO-044/SP   cua ong 35.00   hien tai 0.00     <- cung cap do, dao chieu
```

Tập giá hai bên y hệt: {0.00, 35.00, 42.30}. Đúng **một** trong mười một là thật.

Nếu hành động theo báo cáo đó thì đã "sửa" mười thứ vốn đang đúng, trên một shop
đang bán hàng. Đó chính là kiểu hỏng mà cả buổi kiểm tra này sinh ra để tránh.

Khoá lặp là **lỗi của câu truy vấn**, không phải phát hiện. Công cụ giờ dừng lại
và nói ra khi thấy khoá lặp, thay vì báo nó như dữ liệu. Gộp bằng `string_agg`
có `ORDER BY` để mỗi khoá ứng đúng một dòng, và khi đó phép so là so **hai tập
hợp** chứ không phải hai thứ tự tình cờ của cùng một tập.

---

## 21. Lớp là của khách, nhưng giá trị mặc định trong lớp không phải là cấu hình của khách (30 Aug)

Bảng cước của khách là các lớp Ruby chính ông viết, và mỗi lớp khai mặc định:

```ruby
preference :parcel_base_fee,     :decimal, default: 1.90
preference :min_weight_kg,       :decimal, default: 0.1
preference :volumetric_divisor,  :decimal, default: 6000.0
```

Ngày 25/08 bộ nâng cấp **tạo một dòng calculator mới** cho Standard Postage của au
thay vì chuyển đổi dòng đang có. Dòng mới lấy mặc định của lớp. Giá trị ông tự
đặt trong admin, sửa lần cuối 11/02, nằm lại trên một dòng không còn ai trỏ tới.

Đo trên chính đơn thật ngày 29/08, một bình 0.08 kg đi nội địa:

```
so cua ong   {0.95, 0.05, 7000}  ->  5.71 AUD
mac dinh lop {1.90, 0.10, 6000}  ->  6.79 AUD   <- khach da tra
```

Không gì hỏng. Checkout chạy, có báo giá, đơn hoàn tất, tiền vào. Mọi cổng kiểm
tra đều xanh, kể cả browser walk bỏ hàng thật vào giỏ thật, **vì một cái giá sai
vẫn là một cái giá**.

### Câu hỏi khó, và cách trả lời nó

Lớp là của ông, nên mặc định viết trong lớp cũng là chữ của ông, và file đó ông
gửi ngày 24/08 — mới hơn dòng database sửa 11/02 sáu tháng. Lập luận đó nghe hợp
lý và nó **sai**.

Trọng tài không phải file, không phải database của mình, mà là **hệ thống đang
chạy thật của ông**. Bản đối chứng nguyên vẹn `au_pristine` trả lời dứt điểm:

```
server cua ong, id 21, AuStandardShippingCalculator
  {chia the tich 7000, phi goc 0.95, toi thieu 0.05}   sua lan cuoi 2026-02-11
```

Ông đã chạy đúng bộ số đó sáu tháng trên shop thật của ông. Mặc định của lớp là
thứ Spree dùng khi tạo một dòng trống, không phải thứ ông cấu hình.

**Giữ một bản đối chứng nguyên vẹn của mỗi dump.** Không có `au_pristine` thì câu
hỏi này không có cách nào trả lời, chỉ có hai phía cùng nghe hợp lý.

---

## 22. Đo bằng cửa vào sai thì kết luận shop hỏng trong khi shop vẫn tốt (30 Aug)

Ba lần trong một buổi, phép đo sai chứ không phải hệ thống sai.

**Gọi calculator bằng `Shipment` thay vì `Package`.** Ra `NotImplementedError:
Please implement 'compute_shipment(shipment)'`, đọc như một shop không báo giá
được. Lớp của ông hiện thực `compute_package(package)`, và checkout thật dựng
package. Cửa vào đúng là `shipment.to_package`.

**Lọc API bằng permalink.** `filter[taxons]=collections/on-sale` trả 0 sản phẩm
trên au, và cũng trả 0 trên nz — mà browser walk của nz cùng ngày đếm được 12 sản
phẩm trên đúng trang đó. Cùng một câu hỏi sai cho cả hai.

**Đếm `/products/` trong HTML lấy bằng curl.** Trả 0 cho cả au lẫn nz. Storefront
là Next, liên kết sản phẩm không nằm trong HTML đầu tiên theo dạng đó.

Cách thoát khỏi cả ba giống nhau: **chĩa phép đo vào một shop đang chắc chắn tốt
trước.** Nếu nó cũng báo hỏng thì hỏng là ở phép đo. Ba mươi giây, và nó chặn
được ba kết luận sai liên tiếp.

## 23. So đơn bằng `completed_at` thì giỏ chưa hoàn tất vô hình (31 Aug)

Nạp lại một shop từ dump của khách là một lệnh restore, nên nó thay toàn bộ. Câu
hỏi bắt buộc là "có gì chỉ tồn tại bên mình sẽ bị xoá". Ngày 30/08 câu hỏi đó đã
được hỏi, và hỏi sai.

Phép so dùng:

```sql
SELECT count(*) FROM spree_orders WHERE completed_at IS NOT NULL
```

Một giỏ chưa hoàn tất có `completed_at` rỗng, nên **không bao giờ xuất hiện**.
Với au thì may, vì đơn cần cứu là đơn đã hoàn tất nên nó lọt vào lưới. Với nz thì
không: hai khách thật đã đi tới bước thanh toán rồi bỏ dở, và lần nạp lại xoá cả
hai. Khách hàng phát hiện ra trước mình, một ngày sau.

```
don thu nhat   122.97  tao 28/08 22:06  trang thai payment
don thu hai     67.79  tao 29/08 21:12  trang thai payment
```

Đây là loại đơn **đáng giá nhất để mất**: khách đã điền địa chỉ, đã chọn giao
hàng, đã tới bước trả tiền. Chủ shop muốn liên hệ lại chính những người này.

### Phép so đúng, và cách đọc kết quả

So **mọi số đơn ở mọi trạng thái**, hai chiều. Trên nz nó ra 36 đơn mất. Nhưng
34 trong số đó là giỏ do chính browser walk của mình tạo ra, và chúng tự khai:

```
khong email, khong ten, khong dia chi, cung mot muc tien lap lai
  nz: 30.30 hoac 51.20      au: 25.93 x 23 don
```

Nên tiêu chí phân loại không phải là trạng thái mà là **có dấu vết người thật hay
không**: một email, một cái tên, một địa chỉ. Hai đơn nz có cả ba. Hai mươi ba
đơn au không có cái nào, và không có đơn khách thật nào mất trên au.

### Việc browser walk để lại rác trong database của khách

Mỗi lần chạy `check_storefront_e2e` là thêm một sản phẩm vào một giỏ mới, và giỏ
đó nằm lại trong database đang chạy của khách. Sau vài chục lần chạy, 34 trên 36
đơn "mất" là của mình. Chúng vô hại và chúng làm nhiễu đúng phép đo quan trọng
nhất, nên khi đọc kết quả phải tách chúng ra trước, bằng dấu vết người thật chứ
không bằng ngày tháng.

### Cổng chống rò rỉ chỉ biết tên nó được cho trước

Hai lần trong hai ngày, tên và email của một khách hàng thật đi vào file trong
repo công khai, trong lúc viết lại chính phép đo vừa làm. Cả hai lần
`check_no_client_data` đều xanh.

Nó xanh vì nó đúng chức năng: nó so với `.clientscan-patterns`, một danh sách
thương hiệu, tên miền và tên sản phẩm của khách. **Danh sách đó không thể chứa
khách hàng của khách**, vì không ai biết tên họ trước khi họ đặt hàng.

Nên thêm một lượt quét thứ hai, khớp theo **hình dạng** thay vì theo tên, và tự
nó không nêu tên ai:

```
so don      ba chu hoa lien tiep roi chin chu so
email       bat ky dia chi that nao, tru danh sach placeholder
```

Ba chi tiết làm nó dùng được thay vì bị tắt đi:

**Phân biệt hoa thường.** Khớp không phân biệt thì một chuỗi sha256 trong
`Gemfile.lock` chứa `eca4752...` và đọc thành một số đơn.

**Placeholder phải đa ngôn ngữ.** Lần chạy đầu bắt luôn form đăng ký tiếng Đức,
Tây Ban Nha, Pháp và Ba Lan, vì mỗi người dịch viết "example" bằng tiếng của họ
và tôi chỉ trừ chữ tiếng Anh. Một cổng kêu oan bốn file dịch là một cổng sẽ bị
tắt.

**Bỏ qua file nhị phân.** Một file PDF khớp trên chính luồng nén của nó.

Và điều cuối, quan trọng nhất: sau khi sửa, phải **tạo một file mồi chứa đúng thứ
đã để lọt** rồi chạy lại. Xanh vì không có gì để bắt và xanh vì bắt đúng là hai
chuyện khác nhau, và chỉ có cách đó phân biệt được.

## 24. Build arg khai trong Dockerfile mà không ai truyền thì rơi vào im lặng (31 Aug)

Ô nhập thẻ Stripe và nút PayPal do **script của chính hai hãng đó vẽ trong trình
duyệt**, nên mỗi cái cần khoá công khai của mình được nướng vào bản build.
Dockerfile của storefront khai đủ cả hai từ lâu:

```
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID=""
```

và `shop_host storefront` **chưa bao giờ truyền cái nào**. Một `--build-arg`
không được truyền thì Docker lấy giá trị mặc định, ở đây là chuỗi rỗng, và
không nói gì cả.

Hậu quả trên bảy shop đang bán hàng:

```
loadStripe(undefined)        -> null
<Elements stripe={null}>     -> mot the div rong
PayPal khong co client id    -> nut khong bao gio moc
```

Khách đi hết checkout, cước tính đúng, nút Pay Now hiện ra, và dưới "Card
Payments" là **một ô xám trống**. Không lỗi, không log, không request nào hỏng.
Chủ shop chụp màn hình khoanh đỏ đúng cái ô trống đó và hỏi có phải nó vốn thế
không.

### Ba lần đo sai trước khi tới đúng chỗ

`printenv NEXT_PUBLIC_...` trong container **luôn rỗng**, kể cả khi mọi thứ
đúng, vì `NEXT_PUBLIC_` được thay thẳng vào mã lúc build chứ không tồn tại lúc
chạy. Đây là bài học đã ghi ở chỗ khác của dự án và tôi vẫn dẫm lại.

`js.stripe.com` **có tải** nên tôi kết luận Stripe hoạt động. Stripe.js tự chèn
một iframe `m-outer` để lấy vân tay, độc lập với Elements. Có Stripe.js không có
nghĩa là có ô nhập thẻ.

Đếm iframe cũng chưa đủ: trang có 2 iframe, và cả hai đều không phải ô thẻ. Chỉ
khi **đo kích thước từng cái** mới thấy `m-outer` là `1440x1`. Sau khi sửa thì
có 9 iframe, trong đó `elements-inner-accessory-target` là `526x319`. Con số
đó, chứ không phải số lượng, mới là bằng chứng.

### Cách lấy khoá, và cái bẫy trong đó

Khoá công khai đã nằm sẵn trên chính payment method của từng shop, do khách tự
nhập. Đọc từ đó chứ đừng gõ tay. Nhưng `bin/rails runner` in banner khởi động
của Spree ra stdout **trước** khi script chạy, nên lấy cả output sẽ được 364 ký
tự `[Spree Events] Event logging enabled` ở chỗ đáng lẽ là khoá, và Docker nướng
luôn chuỗi đó vào ảnh. Bọc giá trị trong một dấu mốc rồi cắt ra:

```ruby
print %q{<<K:} + value + %q{:K>>}
```

---

## 25. Một thẻ `<p>` nuốt sạch xuống dòng, và người dùng bị đổ lỗi cho HTML (31 Aug)

Hướng dẫn chuyển khoản ngân hàng được gõ trong admin dưới dạng chữ thường có
xuống dòng: tên tài khoản một dòng, số tài khoản dòng dưới, kèm link tới file
PDF. Checkout vẽ nó bằng:

```jsx
<p className="text-sm text-gray-600 mb-2">{pm.description}</p>
```

Trình duyệt gộp mọi khoảng trắng trong một `<p>`, nên **705 ký tự thông tin ngân
hàng đổ ra thành một khối liền**, số tài khoản dính vào tên ngân hàng.

Chủ shop làm điều hợp lý nhất: thêm HTML để lấy lại xuống dòng. React thoát HTML
nên ông thấy nguyên các thẻ. Rồi ông bỏ hết HTML đi và vẫn không có xuống dòng.
Hai lần đều đúng, và cả hai lần trang đều vứt bỏ hình dạng của văn bản.

Đo trước khi sửa, và phép đo trả lời luôn:

```
do dai=705  co xuong dong=true  co the HTML=false
```

Chữ của ông vẫn còn nguyên xuống dòng. Vấn đề nằm hoàn toàn ở chỗ vẽ. Một class
`whitespace-pre-line` là đủ, cộng thêm việc biến URL trần thành link bấm được,
vì đó là màn hình duy nhất khách đang được yêu cầu chép số cho cẩn thận.

Bài học không phải về CSS. Là: khi người dùng nói "tôi gõ đúng rồi mà nó vẫn
sai", hãy **đo cái họ đã gõ** trước khi giải thích cách gõ cho đúng.

## 26. Sửa trước rồi mới thử xoá, và khi xoá hỏng thì cái sửa nằm lại (31 Aug)

Chủ shop gửi danh sách 13 đơn thử và 2 tài khoản thử cần bỏ. Xoá một đơn đã hoàn
tất trong Spree không đơn giản như nó tưởng, và cách làm sai đã làm hỏng dữ liệu
thật của ông trên shop đang bán hàng.

### Ba điều Spree làm mà một `destroy!` không lường

**`Spree::LineItem` có `before_destroy` từ chối khi đơn cha đã hoàn tất.** Nên
`order.destroy` trên đơn `complete` gãy ngay ở dòng hàng đầu tiên và cuộn ngược
toàn bộ. Cách đi qua là xoá `completed_at` bằng `update_column` (không chạy
callback) trước.

**`destroy` trả về giá trị giả kể cả khi thành công.** Đo trên một đơn thật
trong giao dịch có hoàn tác: `destroy` trả `nil`, mà đơn, 2 dòng hàng, 1 thanh
toán, 1 lô giao và 2 dòng tồn kho đều biến mất. `destroy!` đọc `nil` đó thành
thất bại và ném lỗi. **Phải phán xét bằng sự vắng mặt trong database, không bằng
giá trị trả về.**

**Chốt chặn xoá khách chỉ đếm đơn ĐÃ HOÀN TẤT.** `check_completed_orders` trong
`user_methods.rb` không đếm đơn dở dang.

### Ba điều đó cộng lại thành một cú hỏng

Bản đầu xoá `completed_at` của cả 13 đơn **trước**, rồi mới lần lượt thử xoá. 12
đơn xoá không được. Kết quả:

```
397 don hoan tat -> 385      12 don that bi go dau "da hoan tat" trong im lang
76 khach -> 74               chot chan het chan, vi ho khong con don hoan tat nao
0 don mo coi -> 12           hai tai khoan bi xoa, keo theo chu so huu cua 12 don
```

Không lệnh nào báo lỗi ngoài một dòng "FAILED" ở cuối. Sửa bằng cách nạp lại bản
backup lấy đầu lượt, và bản đó tồn tại **chỉ vì công cụ bắt buộc phải có backup
mới chạy**. Đó là lần đầu tiên trên dự án này quy tắc "dump trước đã" thật sự cứu
một cái gì.

### Hình dạng đúng: mỗi đơn một giao dịch, hỏng thì hoàn tác

```ruby
Spree::Order.transaction do
  o.update_column(:completed_at, nil)
  o.destroy
  if Spree::Order.exists?(id: oid) then raise ActiveRecord::Rollback else done = true end
end
```

Sửa `completed_at` là một thay đổi thật trên đơn thật. Nó chỉ được phép tồn tại
nếu dòng đó biến mất ngay sau đó. Chạy lại bản này trên đúng 13 đơn ấy: **12 đơn
đi sạch, 0 mồ côi, 0 thanh toán mồ côi, 0 dòng hàng mồ côi**, và một lượt hỏng
trước đó không để lại một dấu vết nào.

Và tài khoản chỉ được xoá khi nó **không còn đơn nào ở bất kỳ trạng thái nào**,
chặt hơn chốt của Spree, vì chính chỗ lỏng đó đẻ ra 12 đơn mồ côi.

### Một dấu nháy đơn trong chú thích giết cả lệnh

Đoạn Ruby được nhét vào một tham số **nháy đơn** cho shell từ xa. Tôi viết chú
thích dài bên trong nó, có những chữ như `client's` và `LineItem's`. Mỗi dấu
nháy đó đóng sớm chuỗi, lệnh chết, và **không in ra một dòng nào** — nhìn y hệt
như bước xoá đơn giản là không chạy. Mất hai lượt mới thấy.

Chú thích thuộc về phía bash, bên ngoài chuỗi. Phần Ruby nhúng phải ngắn và
không có dấu nháy đơn.

## 27. Một luật khuyến mãi làm hai việc, và việc thứ hai đuổi khách đi (31 Aug)

Chủ shop báo: khách nhận được mã giảm giá nhưng chỉ dùng được khi đã đăng nhập,
và nhiều người không muốn tạo tài khoản.

Không phải một công tắc của shop. Là một luật gắn trên từng khuyến mãi,
`Spree::Promotion::Rules::OneUsePerUser`:

```ruby
def eligible?(order, _options = {})
  if order.user.present?
    if promotion.used_by?(order.user, [order])
      eligibility_errors.add(:base, eligibility_error_message(:limit_once_per_user))
    end
  else
    eligibility_errors.add(:base, eligibility_error_message(:no_user_specified))
  end
  eligibility_errors.empty?
end
```

Nhánh `else` là chỗ chết: đơn của khách vãng lai không có `user`, nên luật luôn
từ chối. Chứng minh trên một đơn khách vãng lai thật của shop đang chạy:

```
eligible? = false
"You need to login before applying this coupon code."
```

### Vì sao không thể chỉ gỡ nó ra là xong

Luật này gánh **hai** việc trong một dòng: chặn khách vãng lai, và chặn cùng một
khách dùng lại mã. Gỡ nó là mất cả hai. Mã trở thành dùng lại vô hạn, bởi bất kỳ
ai.

Thứ thay thế duy nhất chạy được khi không có tài khoản là `usage_limit` trên
`spree_promotions`, tức giới hạn **tổng lượt trên toàn bộ mọi người**. Nó không
phải cùng một sự bảo vệ, và đó là lựa chọn duy nhất còn lại.

Nên câu trả lời đúng không phải "gỡ đi" mà là một lựa chọn có hậu quả nêu rõ, để
chủ shop quyết. Đo trên toàn hệ: 11 mã trên 4 shop mang luật này, **không mã nào
có `usage_limit`**, và ba shop còn lại vốn đã không có luật nên đã dùng được cho
khách vãng lai từ đầu.

## 28. `if fallback` là chuỗi con của `elsif fallback`, nên phép kiểm thứ tự nhánh luôn xanh (1 Sep)

Partial logo email chọn giữa hai nguồn: ảnh chủ shop upload lên store, và một URL
mà mỗi shop tự ghi trong bộ chữ riêng của nó. Cái nào thắng chỉ là thứ tự hai
nhánh:

```erb
<% if attached %>   ... <% elsif fallback %>   thứ tự cũ
<% if fallback %>   ... <% elsif attached %>   thứ tự mới
```

Thứ tự được đảo trên một shop rồi không bao giờ tới sáu shop kia.

### Phép đo báo xanh trong khi sáu shop sai

Để xác nhận cả bảy đã có bản mới, tôi chạy:

```bash
grep -q "if fallback" app/views/spree/shared/_email_logo.html.erb && echo MOI
```

Cả bảy trả về `MOI`. Nhưng `elsif fallback` **chứa** `if fallback`, nên bản CŨ
khớp với phép thử dành cho bản MỚI. Một `grep` tìm mảnh chuỗi không thể phân biệt
một thứ tự với thứ tự ngược lại của chính nó.

Đo lại bằng chuỗi phân biệt được thì ra sự thật:

```
sáu shop     <% if attached ... <% elsif fallback     (cũ)
một shop     <% if fallback ... <% elsif attached     (mới)
```

### Hậu quả trên khách thật

Dựng email xác nhận đơn thật của từng shop rồi đọc thẻ `<img>` đầu tiên: **ba shop
khác nhau gắn cùng một file ảnh**, trong khi mỗi shop đã có logo riêng ghi sẵn
trong bộ chữ của nó, và cả ba URL riêng đó đều trả 200. Sáu trên bảy shop gửi cho
khách một logo không phải logo được chỉ định.

Không có gì báo lỗi. Email vẫn dựng, vẫn gửi, vẫn trông hoàn chỉnh. Đây đúng là
lỗi chủ shop đã báo một lần trước đó, và nó chỉ được sửa trên đúng shop ông báo.

### Bài học đã thành cổng kiểm

`script/check_email_logo` dựng email thật qua `Spree::OrderMailer`, cùng đường mà
`emails:smoke` đi, rồi đọc chính thẻ `<img>` khách nhận được. Hai cách trượt: shop
gắn ảnh không khớp bộ chữ của nó, hoặc hai shop gắn cùng một ảnh.

Nó **không** đặt `I18n.locale`. Locale nào đang chạy lúc dựng mail là một phần của
thứ đang được đo, và một probe tự đặt locale sẽ sửa lỗi trước rồi mới đo cái đã sửa.

Điều tổng quát hơn: **một phép kiểm tìm mảnh chuỗi không đo được thứ tự.** Muốn
biết thứ hai nhánh nào thắng thì phải chạy nó ra kết quả, chứ không đọc mã nguồn.

## 29. Xoá chữ trong ô không xoá được cái đơn, và khách hàng là người phát hiện (1 Sep)

`check_note_box` mở checkout thật trên từng shop, gõ vào ô ghi chú, tải lại trang,
đọc lại. Bản đầu để lại nguyên câu thử trong giỏ của 20 người. Đã sửa: probe xoá
chữ trước khi thoát.

Sửa như vậy **chưa đủ**, và tôi đã tin là đủ.

### Cái bị bỏ sót

Đi tới checkout làm đơn chuyển trạng thái từ `cart` sang `address`. Xoá chữ không
đụng gì tới điều đó. Nên mỗi lần chạy cổng để lại **một đơn nháp trên mỗi shop**,
và chúng tích lại.

Chủ shop mở màn hình Draft Orders, thấy một cột toàn `N/A` ở ô khách hàng, và hỏi
có phải hệ thống hỏng gì không. Đo lúc đó: **24 đơn trên 5 shop**, tất cả tạo trong
cùng một ngày, dồn thành từng cụm cách nhau vài phút đúng bằng nhịp cổng đi qua hệ.

Không có gì hỏng. Ông đang nhìn probe của chúng tôi.

### Một dấu vân tay trông rất thuyết phục, và nó sai

Các đơn đó mang `special_instructions = ''` — chuỗi rỗng, không phải NULL. Lập luận
lúc đó: chỉ thứ gì gõ vào ô rồi xoá mới để lại như vậy, khách chưa chạm vào ô thì để
NULL. Nghe kín kẽ, và tôi đã ghi nó vào đây như một sự thật.

Đo lại toàn hệ thì **sai**:

```
don chua xong co ghi chu = chuoi rong:  221
trong do co email hoac tai khoan:       221
trong do an danh:                         0
som nhat:                        31/08/2025
```

221 đơn thật mang chuỗi rỗng, sớm nhất từ một năm trước khi probe này tồn tại. Ô ghi
chú được ghi `''` chứ không phải NULL trong đường đi bình thường. Chuỗi rỗng **không**
phân biệt được gì cả.

Thứ thật sự nhận diện được probe là **tổ hợp**, và mảnh mạnh nhất trong đó không phải
ô ghi chú: đơn ở trạng thái `address` mà **không có email**. Khách thật đi qua được
`cart` chính là nhờ nhập email; probe thì không.

Con số cứu tôi: sau khi xoá, số đơn ẩn danh mang chuỗi rỗng còn **0**, đúng bằng việc
24 đơn bị xoá là toàn bộ của probe và không dư một đơn khách nào.

Và ngay cả tổ hợp đó cũng **không** dùng làm điều kiện xoá lâu dài được, vì trên shop
đóng probe đăng nhập bằng tài khoản của chính chủ shop, nên đơn nó tạo mang `user_id`
của ông. Mọi guard hình dạng "khách vãng lai" đều bỏ qua đúng cái shop mà rác trong
giỏ đáng ngại nhất.

### Cách làm đúng

Probe **để nguyên** câu đánh dấu. Cổng xoá cả đơn theo **đúng câu đó**, so sánh bằng,
không phải `LIKE`:

```ruby
Spree::Order.where(completed_at: nil, special_instructions: marker)
            .where('created_at > ?', 30.minutes.ago)
```

Xoá đơn thì chữ đi theo, còn xoá chữ thì đơn ở lại. Một chiều đúng, chiều kia không.

So sánh bằng chứ không `LIKE`, vì một lượt dọn trước đây dùng `%Waze app%` và khớp
trúng đơn thật của một khách hàng.

### Điều tổng quát

**Một phép kiểm chạy trên hệ thống đang bán phải trả lại hiện trường như lúc nó đến,
và "hiện trường" gồm cả những hàng nó tạo ra, không chỉ những ô nó gõ vào.** Trước
khi tin là đã dọn sạch, hãy hỏi trạng thái nào đã thay đổi mà mình chưa nhìn tới.

Và cái thứ hai, đắt ngang: **một dấu vân tay chỉ là dấu vân tay sau khi đã đếm xem
bao nhiêu thứ khác cũng mang nó.** Ở đây là 221. Lập luận "chỉ probe mới để lại như
vậy" nghe kín kẽ và không tốn gì để kiểm, mà tôi vẫn viết nó ra trước khi đếm.

## 30. Tên shop và tên quốc gia trùng nhau ở bảy shop, nên không ai thấy chúng là hai thứ (1 Sep)

Storefront tra mọi thứ riêng của từng shop bằng **một** khoá: `NEXT_PUBLIC_DEFAULT_COUNTRY`.
Trang chủ, sáu trang nội dung, ảnh thương hiệu, liên kết chân trang, thanh thông báo,
màu chủ đề — 14 chỗ, tất cả dùng chung nó.

Điều đó đúng suốt vì bảy shop bán lẻ có tên shop **bằng** tên quốc gia: shop `nz` ở
quốc gia `nz`.

Shop thương mại phá vỡ giả định đó. Nó là một doanh nghiệp New Zealand, nên quốc gia
là `nz` — đúng cho tiền tệ, thị trường và đường dẫn. Nhưng nó **không phải** shop bán
lẻ New Zealand.

### Hậu quả đo được

```
/pages/about              404
/pages/faq                404
/pages/product-sourcing   404
```

Ba trang đó, cùng ba trang nữa, nằm sẵn trong repo dưới khoá `business` và **không ai
từng tra tới**. `content.ts` đã ghi nhận đúng nửa vấn đề này và dừng ở đó:

> *"A key of its own exists because the commercial shop had none ... That is the
> reason these pages had nowhere correct to go and is why moving them is only half
> the fix."*

### Cái bẫy nằm ở nửa còn lại

Compose của shop đó **không truyền quốc gia như build arg**, chỉ đặt ở khối
`environment` lúc chạy. Với một tên `NEXT_PUBLIC_*` thì việc đó **không có tác dụng
gì**: Next nướng chúng vào bundle lúc build.

Nên bản build hiện tại không có quốc gia, mọi phép tra đều trượt, và trang chủ ra bản
mặc định của framework.

Chỗ nguy hiểm: **sửa đúng một dòng đó là làm mọi thứ tệ hơn.** Thêm mỗi quốc gia thì
mọi phép tra ăn về `nz`, và shop bán sỉ lập tức hiện lời chào, câu chuyện About và ô
đăng ký nhận thư của shop **bán lẻ**. Đúng cái lỗi mà `content.ts` mở đầu bằng lời
cảnh báo, và đúng cái chủ shop đã tự bắt được trên shop Canada.

Mìn đã cài sẵn, chỉ chưa nổ, vì shop chưa được build lại từ 13/08.

### Cách sửa

Một khoá riêng, `NEXT_PUBLIC_SHOP_KEY`, **rơi về quốc gia khi không đặt**. Bảy shop
bán lẻ không đặt nó nên tra y như cũ và không thể hỏng vì thay đổi này. Chỉ shop nào
có lời khác quốc gia mới đặt.

Hai dòng đó phải đi **cùng nhau** vào compose, và lý do được viết ngay trên chúng.

### Điều tổng quát

**Hai thứ trùng giá trị nhau trong mọi trường hợp đang có không có nghĩa chúng là một
thứ.** Chúng chỉ chưa khác nhau. Chỗ để phát hiện là trường hợp đầu tiên phá vỡ sự
trùng khớp, và ở đó thứ đắt nhất không phải là lỗi — mà là bản sửa nửa vời trông như
đã xong.

## 30. `spree_page_builder` cài được trên 5.6.1, và nó dựng cho một storefront mà hệ này không có (1 Sep)

Chủ shop hỏi: gem `spree_page_builder` có tồn tại không, cài lên được không, và
editor có hiện trong admin không. Đo trên **site thử cục bộ**, không đụng shop nào
đang bán.

### Có, và cài sạch

```
spree_page_builder  v5.4.6   28/07/2026   Vendo (chinh cong ty lam Spree)
  phu thuoc: spree >= 5.4.0, spree_admin >= 5.4.0, spree_posts >= 0
```

Ràng buộc là `>=`, không phải `~>`, nên **5.6.1 thoả**. `bundle install` xong không
xung đột, app vẫn khởi động, `bin/rails generate spree:page_builder:install` chạy
hết và tạo `spree_themes`, `spree_page_links`, `spree_page_blocks`, `spree_posts`,
`spree_post_categories`.

Admin mọc thêm **Storefront → Pages / Settings**, **Posts**, và trang **Themes** có
thư viện theme kèm ảnh xem trước, nút Add, và cơ chế sao chép theme rồi đẩy lên live.

Editor mở thật ở `/admin/themes/1/edit`: panel Page sections (Announcement Bar,
Header, Image With Text, Newsletter, Footer), mỗi mục có **Add Page Block**, có
**ADD SECTION**, chọn trang, chuyển mobile/desktop, **Preview** và **Publish**.

### Nhưng khung xem trước rỗng, và đó mới là câu trả lời

Đo tiếp thay vì kết luận sớm:

```
iframe xem truoc      src = rong          392x800
Rails /               200  "Dashboard"    578 ky tu   <- trang admin
Rails /products       404
```

**Ứng dụng này không có storefront Rails nào cả.** Nó headless: khách được phục vụ
bởi một app Next.js riêng, gọi vào Spree qua API. Page builder được viết để dựng
**storefront Rails của Spree**, nên editor chạy đúng và không có gì để render.

Nghĩa là thứ nó Publish sẽ không xuất hiện trên các shop này. Muốn dùng thì phải
đọc `spree_themes` / `spree_page_blocks` qua API rồi tự render bên Next, tức viết
lại phần render — không phải cài thêm một gem.

### Nhưng "trống" và "hỏng" cũng là hai chuyện, và phải thử tiếp mới biết

Bản ghi đầu của mục này dừng ở đây, và nó để lại đúng câu hỏi mà người đọc sẽ hỏi:
*editor trống thế là đúng, hay là nó hỏng?* Ba phép đo ở trên **không** trả lời được
câu đó. Nên thử tiếp.

`spree_storefront` v5.4.6 tồn tại, cùng số phiên bản với page builder, tức bộ đôi
đi kèm. App này **không cài gem storefront nào**. Cài cả hai vào site thử:

```
bundle install                          sach, 5.6.1 thoa het rang buoc
spree:storefront:install                chay xong
Rails /                                 500  "asset tailwind.css khong tim thay"
bin/rails tailwindcss:build             570ms
Rails /                                 200  "Shop"  58 KB
```

Cái 500 đó là **thiếu bước build asset**, không phải không tương thích — phân biệt
được hai thứ đó là toàn bộ giá trị của phép thử này.

Mở lại editor:

```
iframe src   /?page_preview_id=17&theme_id=1&theme_preview_id=4&page_builder=true
noi dung     600 ky tu
tieu de      Shop, Heading Default, About us
```

Khung xem trước render đúng các section trong panel bên trái. **Editor không hỏng.**
Ô xám trống lúc đầu là trạng thái ĐÚNG của một editor không có storefront để vẽ.

### Và hoá ra chủ shop đã dùng nó hơn một năm

Kiểm hệ thật xem có bị lây từ phép thử không (không, phép thử chỉ chạy cục bộ). Kết
quả ngoài dự tính: **sáu trên bảy shop đã có sẵn 4 bảng page-builder**, trong khi gem
không hề được cài.

```
shop        spree_themes   spree_page_blocks
ban le A       1499             21535
ban le B       1394             19753
ban le C       1377             19536
ban le D       1373             19491
ban le E       1347             19267
ban si          203              2623
shop moi dung     0                 0
```

Theme sớm nhất 30/05/2025, mới nhất 14/08/2026 — tức tới sát ngày cắt chuyển. Đó là
**sử dụng thật, hơn một năm**, không phải cài nhầm. Shop duy nhất trống là shop dựng
mới từ đầu, đúng như dự đoán.

Các bảng này theo dump của ông sang 5.6.1 và **đang nằm im**: shop mới dùng storefront
Next, nên không gì đọc chúng.

Con số 1.499 theme cũng đáng nói: quy trình của page builder là *sao chép theme rồi
đẩy bản sao lên live*, nên mỗi lần sửa là một bản sao. Gần 1.400 bản sao cũ mỗi shop.

### Kết luận cho câu hỏi thật

Với khách dùng storefront Rails của Spree, đây là lựa chọn thật và tốt — và chủ shop
này là một trong số đó, ông đã dùng nó suốt trên bản 5.2.

Với shop headless Next như hệ hiện tại, muốn dùng thì phải đọc `spree_themes` /
`spree_page_blocks` qua API rồi tự render bên Next — tức viết lại lớp render, không
phải cài một gem. Nội dung ông đã dựng vẫn còn nguyên trong database nếu sau này
muốn dùng lại.

### Bài học về cách thử

Câu "cài được không" và câu "dùng được không" là **hai câu khác nhau**, và cái thứ
hai chỉ trả lời được bằng cách mở ra xem. Nhưng còn một câu thứ ba dễ bỏ sót hơn:
**"trống thế là đúng hay là hỏng"** — và cách duy nhất trả lời là dựng đủ điều kiện
cho nó chạy rồi so hai trạng thái. Nếu dừng ở kết luận "không có storefront nên
trống", báo cáo vẫn đúng chữ mà chưa chứng minh được gì.

Việc thử để lại rác phải dọn: bộ cài ghi **5 file migration** vào `db/migrate/` và
sửa `db/schema.rb`. Để nguyên thì lần deploy sau sẽ tạo bảng page builder trên mọi
shop. Đã gỡ gem, xoá migration, trả `schema.rb`, và xác nhận shop thật còn 0 dòng.
