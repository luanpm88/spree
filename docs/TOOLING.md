# Tooling

Các script tự động của project. Không có gì trong đây là bắt buộc để chạy Spree — chúng
tồn tại để **tài liệu và bằng chứng luôn khớp với hệ thống thật**, thay vì viết tay rồi
lệch dần.

Bài học rút ra khi viết chúng: [DISCOVERIES.md §4](DISCOVERIES.md).

---

## Tổng quan

| Script | Làm gì |
|---|---|
| `script/deploy` | Toàn bộ việc deploy. Xem [DEPLOY.md](DEPLOY.md). |
| `script/capture_screenshots.mjs` | Chụp 24 màn hình từ **máy local** |
| `script/capture_prod.mjs` | Chụp 15 màn hình từ **production** (admin + storefront) |
| `script/build_guide.mjs` | Markdown → PDF (Chromium, không cần pandoc/LaTeX) |
| `script/audit_roles.mjs` | Đăng nhập từng vai trò, dò 9 màn hình, so với kỳ vọng |
| `script/verify_handover.mjs` | Kiểm chứng từng câu trong HANDOVER trên production |
| `script/smoke_mail.rb` | Gửi thử email, xác nhận SMTP thật sự hoạt động |
| `lib/tasks/demo.rake` | Tạo tài khoản demo cho từng vai trò |

Cần: `npm install` (chỉ Playwright + markdown-it, **không** dùng cho app), và
`npx playwright install chromium`.

---

## Chụp ảnh

```bash
node script/capture_screenshots.mjs                       # local, cần `make up`
ADMIN_PASSWORD=… node script/capture_prod.mjs             # production
```

Ảnh vào `docs/screenshots/` và `docs/screenshots/prod/`, kèm `manifest.json`.

Hai nguyên tắc đã phải học:

- **Không hardcode URL đoán.** Đường dẫn storefront có locale (`/us/en/...`), và một URL
  đoán sai cho ra **ảnh trang 404 trông y như ảnh thật**. Script đọc href từ navigation
  đang chạy.
- **Trang chi tiết mở bằng cách đọc href, không click.** Bảng trong admin bọc link trong
  Turbo frame và overlay → `click()` timeout. Script tìm href khớp
  `/admin/<resource>/<id>` rồi `goto` trực tiếp.

Màn nào lỗi thì **báo rồi bỏ qua**, không làm sập cả lượt chạy — đổi tên route không
chặn việc build lại tài liệu.

---

## Sinh PDF

```bash
node script/build_guide.mjs USER_GUIDE     # → docs/USER_GUIDE.pdf
node script/build_guide.mjs HANDOVER       # → docs/HANDOVER.pdf
```

Dùng Chromium làm engine in, không cần pandoc hay LaTeX. Ảnh được **nhúng thành data
URI** nên file HTML trung gian tự chứa và PDF không phụ thuộc filesystem lúc in.

Bìa và nhãn số trang khai báo trong `COVERS` ở đầu script (HANDOVER tiếng Anh dùng
`page`, USER_GUIDE tiếng Việt dùng `trang`).

Ảnh thiếu **không** làm fail — nó render một ô đỏ ghi rõ tên file thiếu, để lỗi lộ ra
trong bản PDF chứ không im lặng.

> Phải chờ ảnh decode xong mới in, nếu không Chromium đo sai chiều cao. Script chờ
> `document.images.every(i => i.complete && i.naturalHeight > 0)`.

---

## Audit phân quyền

```bash
node script/audit_roles.mjs
```

Đăng nhập lần lượt 6 vai trò, thử 9 màn hình admin, so với bảng `EXPECT` trong script.
Báo cả hai chiều: **thừa quyền** (`OVER-PRIVILEGED`) và **thiếu quyền**.

Đây là thứ đã tìm ra hai vấn đề thật:

- vai trò bán sỉ không xem được tồn kho (`ProductManagement` không kéo theo `StockDisplay`)
- Price Lists bị gate bởi `ProductDisplay` → vai trò chỉ-đọc vẫn xem được giá sỉ

> Cách nhận biết "bị chặn" phải khớp **đúng câu flash của CanCan**. Bản đầu dò
> `/authoriz/i` trên body và báo mọi trang đều bị chặn — vì sidebar có mục *"Return
> **Authoriz**ations"*.

---

## Verify handover

```bash
HANDOVER_PASSWORD=… node script/verify_handover.mjs
```

Đi từ trên xuống dưới `docs/HANDOVER.md` và **kiểm chứng từng câu** trên production:
mọi tài khoản đăng nhập được, phạm vi quyền đúng như mô tả, các URL trả 200, `/jobs` đòi
mật khẩu, API key hoạt động đúng header, mật khẩu mặc định đã chết, và **giá B2B thật sự
giảm khi mua từ 10 cái**.

Ảnh bằng chứng vào `docs/screenshots/verify/`. Thoát khác 0 nếu có câu nào sai, nên dùng
được như cửa chặn trước khi bàn giao.

**Kết quả gần nhất: 40/42.** Hai câu fail là do harness, không phải hệ thống — xem
[DISCOVERIES.md §4.2](DISCOVERIES.md).

Hai bài học đắt nhất nằm ở đây:

- **Kiểm status code là chưa đủ, phải xem `Location`.** `302` sau khi POST login có thể
  là redirect *về lại* trang login = Devise từ chối. Và `GET /admin` trả `200` cả khi
  chưa đăng nhập (nó serve trang login). Đã kết luận sai "8/8 login OK" vì chỉ nhìn
  status code.
- **Form Turbo + Playwright rất dễ race.** Click rồi `goto()` ngay sẽ huỷ fetch submit.
  Triệu chứng là "tài khoản chạy cuối thì fail", rất dễ tưởng là lỗi hệ thống.

---

## Tài khoản demo

```bash
bin/rails demo:seed_users                  # tạo/đặt lại toàn bộ
bin/rails demo:seed_users PASSWORD='...'   # mật khẩu riêng
bin/rails demo:accounts                    # in bảng tài khoản + quyền
```

Idempotent — chạy lại thì cập nhật mật khẩu và gắn lại role, không lỗi trùng.

Permission set của từng role khai báo trong `config/initializers/spree.rb`.
**Tạo `Spree::Role` mà không gán permission set thì người đó đăng nhập được nhưng không
thấy gì** — task này cảnh báo nếu gặp trường hợp đó.

---

## Kiểm tra email

```bash
# local — Mailpit giữ lại, không có mail nào ra internet
make mail

# production — gửi thật
script/deploy console
# hoặc:
docker compose -f docker-compose.prod.yml exec web \
  bin/rails runner script/smoke_mail.rb ban@email.com
```
