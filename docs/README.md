# Documentation

| File | Dành cho | Nội dung |
|---|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) · [PDF](USER_GUIDE.pdf) | mọi người | Spree là gì → khái niệm → chạy thử → B2B → hướng dẫn theo vai trò. 35 trang, ảnh chụp thật. |
| [HANDOVER.md](HANDOVER.md) · [PDF](HANDOVER.pdf) | **khách hàng** | Biên bản bàn giao (tiếng Anh). Đứng độc lập — đăng nhập ở đâu, có gì, chưa có gì. |
| [DESIGN.md](DESIGN.md) | lập trình viên | Kiến trúc, 153 bảng, data model, cơ chế B2B, điểm mở rộng. |
| [LOCAL.md](LOCAL.md) | lập trình viên | Dựng máy cá nhân bằng Docker + 11 lỗi đã gặp và nguyên nhân gốc. |
| [DEPLOY.md](DEPLOY.md) | vận hành | Hai công cụ: `script/deploy` cho máy tham chiếu, `script/commercial` cho máy khách nhiều shop. Khảo sát server, chuyện RAM, backup, rollback. |
| [DISCOVERIES.md](DISCOVERIES.md) | lập trình viên | Toàn bộ phát hiện không hiển nhiên, kể cả về tooling. Đọc trước khi tin một giả định. |
| [TOOLING.md](TOOLING.md) | lập trình viên | Các script tự động: screenshot, PDF, audit quyền, verify handover. |

## Đọc theo tình huống

| Bạn cần | Đọc |
|---|---|
| Hiểu Spree từ đầu | USER_GUIDE §1–2 |
| Chạy trên máy mình | LOCAL |
| Biết Spree lưu dữ liệu thế nào | DESIGN §2–3 |
| Dựng bán sỉ B2B | USER_GUIDE §5, DESIGN §4 |
| Deploy / vận hành | DEPLOY |
| Giao cho khách | HANDOVER (bản PDF) |
| Gặp lỗi lạ | LOCAL §5, DEPLOY §11, DISCOVERIES |

## Cập nhật tài liệu

Ảnh và PDF được **sinh ra**, không sửa tay:

```bash
node script/capture_screenshots.mjs   # ảnh từ máy local
ADMIN_PASSWORD=… node script/capture_prod.mjs   # ảnh từ production
node script/build_guide.mjs USER_GUIDE
node script/build_guide.mjs HANDOVER
```

Chi tiết trong [TOOLING.md](TOOLING.md).
