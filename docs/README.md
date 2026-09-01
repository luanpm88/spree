# Documentation

| File | Dành cho | Nội dung |
|---|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) · [PDF](USER_GUIDE.pdf) | mọi người | Spree là gì → khái niệm → chạy thử → B2B → hướng dẫn theo vai trò. 35 trang, ảnh chụp thật. |
| [HANDOVER.md](HANDOVER.md) · [PDF](HANDOVER.pdf) | **khách hàng** | Biên bản bàn giao (tiếng Anh). Đứng độc lập — đăng nhập ở đâu, có gì, chưa có gì. |
| [DESIGN.md](DESIGN.md) | lập trình viên | Kiến trúc, 153 bảng, data model, cơ chế B2B, điểm mở rộng. |
| [LOCAL.md](LOCAL.md) | lập trình viên | Dựng máy cá nhân bằng Docker + 11 lỗi đã gặp và nguyên nhân gốc. |
| [DEPLOY.md](DEPLOY.md) | vận hành | Hai công cụ: `script/deploy` cho máy tham chiếu, `script/commercial` cho máy khách nhiều shop. Khảo sát server, chuyện RAM, backup, rollback. |
| [DISCOVERIES.md](DISCOVERIES.md) | lập trình viên | Toàn bộ phát hiện không hiển nhiên, kể cả về tooling. Đọc trước khi tin một giả định. |
| MIGRATION_RUNBOOK.md *(gitignored, không có trong bản clone)* | lập trình viên | Đưa một shop từ 5.2/5.4 lên 5.6.1, chạy 7 lần. Ba quả mìn đã biết, thứ tự bắt buộc, và §11 nói rõ chỗ chưa kiểm được. |
| [TOOLING.md](TOOLING.md) | lập trình viên | Các script tự động: screenshot, PDF, audit quyền, verify handover. |
| PLAN.md *(sinh ra từ `plan.json`, gitignored)* | **đọc trước tiên** | Việc đang làm, đang chờ gì, đã hứa gì với khách. `script/plan status` cho một màn hình. Không sửa tay. |
| CUTOVER.md *(gitignored)* | vận hành | Chốt kiểm ngày chuyển đổi. Mọi mục đều xuất phát từ một lỗi có thật. |
| VOICE.md *(gitignored)* | ai viết cho khách | Cách viết tin nhắn và comment, dựng từ 49 tin thật. Đọc trước khi gõ chữ nào ông sẽ đọc. |

## Chốt kiểm: chạy trước khi nói xong

```bash
script/check_all                          # các chốt tĩnh
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
| Deploy / vận hành | DEPLOY |
| Migrate một shop cũ lên 5.6 | MIGRATION_RUNBOOK |
| Giao cho khách | HANDOVER (bản PDF) |
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
ADMIN_PASSWORD=… node script/capture_prod.mjs   # ảnh từ production
node script/build_guide.mjs USER_GUIDE
node script/build_guide.mjs HANDOVER
```

Chi tiết trong [TOOLING.md](TOOLING.md).

