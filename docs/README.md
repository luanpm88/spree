# Documentation

| File | Dành cho | Nội dung |
|---|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) · [PDF](USER_GUIDE.pdf) | mọi người | Spree là gì → khái niệm → chạy thử → B2B → hướng dẫn theo vai trò. Ảnh chụp thật. |
| [HANDOVER.md](HANDOVER.md) · [PDF](HANDOVER.pdf) | **khách hàng** | Biên bản bàn giao (tiếng Anh). Đứng độc lập — đăng nhập ở đâu, có gì, chưa có gì. |
| [DESIGN.md](DESIGN.md) | lập trình viên | Kiến trúc, 153 bảng, data model, cơ chế B2B, điểm mở rộng. |
| [LOCAL.md](LOCAL.md) | lập trình viên | Dựng máy cá nhân bằng Docker + 11 lỗi đã gặp và nguyên nhân gốc. |
| [DEPLOY.md](DEPLOY.md) | vận hành | `script/deploy` cho máy tham chiếu (đã dừng 12/08), `script/commercial` cho máy shop thương mại. Bảy shop live deploy bằng `script/shop_host`, xem MAINTENANCE.md §3. Khảo sát server, chuyện RAM, backup, rollback. |
| [MAINTENANCE.md](MAINTENANCE.md) | vận hành | Giữ bảy shop live sống: từng dòng của `script/health`, việc thường làm sau khi sửa, backup, việc chỉ khách làm được. |
| [DISCOVERIES.md](DISCOVERIES.md) | lập trình viên | Toàn bộ phát hiện không hiển nhiên, kể cả về tooling. Đọc trước khi tin một giả định. |
| MIGRATION_RUNBOOK.md *(gitignored, không có trong bản clone)* | lập trình viên | Đưa một shop từ 5.2/5.4 lên 5.6.1. Bảy shop đã lên 5.6.1 ngày 27–28/08, nên giờ là hồ sơ. Ba quả mìn đã biết, thứ tự bắt buộc, và §11 nói rõ chỗ chưa kiểm được. |
| PLAN_6-0.md *(gitignored)* | lập trình viên | Kế hoạch 5.6 → 6.0 và diễn tập 1 ngày 14/10. Phiên nào chạm 6.0 đọc phần đầu file trước. |
| PLAN_6-0_client.md *(gitignored)* | **khách hàng** | Kế hoạch 6.0 bằng tiếng Anh để khách duyệt. |
| [TOOLING.md](TOOLING.md) | lập trình viên | Các script tự động: screenshot, PDF, audit quyền, verify handover. |
| [email/DESIGN.md](email/DESIGN.md) · [PDF](email/DESIGN.pdf) | lập trình viên | Thiết kế trình dựng email kéo thả. Phần đo trước đó: [email/RESEARCH.md](email/RESEARCH.md). |
| [theme/README.md](theme/README.md) | lập trình viên | Nghiên cứu theme chọn trong admin. Đọc `theme/MECHANISM.md` trước. |
| [RISK_LIST.md](RISK_LIST.md) · [PDF](RISK_LIST.pdf) · [RISK_NETWORK.md](RISK_NETWORK.md) · [PDF](RISK_NETWORK.pdf) | lập trình viên · khách | Danh sách rủi ro khách hàng và chia sẻ dấu hiệu giữa các shop, tiếng Anh, viết 11–14/9. |
| PLAN.md *(sinh ra từ `plan.json`, gitignored)* | **đọc trước tiên** | Việc đang làm, đang chờ gì, đã hứa gì với khách. `script/plan status` cho một màn hình. Không sửa tay. |
| CUTOVER.md *(gitignored)* | vận hành | Chốt kiểm ngày chuyển đổi. Mọi mục đều xuất phát từ một lỗi có thật. |
| VOICE.md *(gitignored)* | ai viết cho khách | Cách viết tin nhắn và comment, dựng từ 49 tin thật. Đọc trước khi gõ chữ nào ông sẽ đọc. |

## Chốt kiểm: chạy trước khi nói xong

```bash
script/check_all                          # chốt đọc repo, cộng chốt ssh vào từng shop live, đọc hai bucket backup, và đi checkout tới Pay Now trên mọi shop
script/check_all https://<host> ca en     # thêm phần mở trình duyệt bấm thật
```

Thoát khác 0 là có chốt hỏng. **Đừng báo xong khi nó chưa xanh**, và đừng báo một
shop chạy được khi phần bấm thật chưa chạy: ngày 17/8 có một shop render hoàn hảo,
trả 200 khắp nơi, và **không nhận được đơn nào** — mọi phép kiểm trước đó chỉ đọc
HTML.

## Bài học mới thì ghi vào đâu

| Loại | File |
|---|---|
| Phát hiện kỹ thuật về Spree / Next / API | `DISCOVERIES.md`, đánh số, kèm phép đo chứng minh |
| Chốt bắt buộc cho ngày chuyển đổi | `CUTOVER.md` |
| Cách làm việc: thói quen sai, chốt còn thiếu | `plan.json` → `learnings` |
| Cách viết cho khách | `VOICE.md` |

Ghi **chuyện đã xảy ra**, đừng ghi lời khuyên. "Một chốt kiểm báo xanh vì không kiểm
được gì thì tệ hơn không có chốt, và chuyện này xảy ra bốn lần trong một ngày" có ích
hơn "cần kiểm kỹ".

## Đọc theo tình huống

| Bạn cần | Đọc |
|---|---|
| Hiểu Spree từ đầu | USER_GUIDE §1–2 |
| Chạy trên máy mình | LOCAL |
| Biết Spree lưu dữ liệu thế nào | DESIGN §2–3 |
| Dựng bán sỉ B2B | USER_GUIDE §5, DESIGN §4 |
| Deploy / vận hành | MAINTENANCE §3 cho bảy shop live; DEPLOY cho máy tham chiếu và máy shop thương mại |
| Migrate một shop cũ lên 5.6 | MIGRATION_RUNBOOK |
| Giao cho khách | HANDOVER (bản PDF), nhưng nó trỏ vào máy tham chiếu đã dừng 12/08 và link tới máy đó trả 502. Sửa cho trỏ vào shop của khách rồi mới gửi lại |
| Gặp lỗi lạ | LOCAL §5, DEPLOY §11, DISCOVERIES |
| Sắp đổi DNS cho một shop | CUTOVER, và `script/check_all https://host <nước>` phải 0 hỏng |
| Viết tin nhắn cho khách | VOICE |
| Muốn biết 7 shop có khoẻ không | `script/health`, và `MAINTENANCE.md` giải thích từng dòng |
| Vừa sửa gì đó, trước khi coi là xong | `script/check_all`, rồi `script/health --quick` |
| Không biết đang làm gì tiếp | `script/plan status` |

## Cập nhật tài liệu

Ảnh và PDF được **sinh ra**, không sửa tay:

```bash
node script/capture_screenshots.mjs   # ảnh từ máy local
ADMIN_PASSWORD=… node script/capture_prod.mjs   # mặc định trỏ vào máy tham chiếu, đã dừng 12/08; đổi bằng ADMIN_URL/SHOP_URL
node script/build_guide.mjs USER_GUIDE
node script/build_guide.mjs HANDOVER
```

Chi tiết trong [TOOLING.md](TOOLING.md).

