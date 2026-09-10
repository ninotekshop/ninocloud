# Ninotek F&B POS

> **Ninotek — Công nghệ & Giải pháp số**
> Hệ thống quản lý bán hàng F&B toàn diện theo mô hình **Hybrid Local-LAN + Cloud Sync**.

| Module | Nền tảng | Công nghệ | Vai trò |
|---|---|---|---|
| **NinoPOS** | Windows Desktop | C# .NET 8 + WPF | Trạm thu ngân, offline-first, in bill ESC/POS 80mm, két RJ11, định lượng kho |
| **NinoOrder** | Android / iOS / Tablet | Flutter 3.x | Nhân viên order tại bàn, kết nối LAN < 0.5s tới NinoPOS |
| **NinoDash** | Android / iOS | Flutter 3.x | Chủ quán xem báo cáo real-time, biểu đồ, cảnh báo kho |
| **NinoCloud** | Server | NestJS + PostgreSQL + Redis | Sync, VietQR, webhook ngân hàng, cấp License |

## Bắt đầu

### Chạy NinoPOS trên Windows

NinoPOS là ứng dụng WPF self-contained cho Windows x64. Cài **.NET 8 SDK**
trên máy build, sau đó chạy PowerShell từ thư mục gốc dự án:

```powershell
.\tools\scripts\publish-windows.ps1
```

Bộ phát hành nằm ở `dist\nino-pos`. Chạy `NinoPOS.exe`; ứng dụng sẽ tự khởi
động LAN server trên cổng `8080`. Nếu tablet ở máy khác trong cùng mạng LAN,
cho phép inbound TCP 8080 trong Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName "NinoPOS LAN" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

Để build ARM64, dùng `-Runtime win-arm64`. Bản Windows hiện bao gồm shell POS,
sơ đồ bàn demo và LAN API in-memory; các module SQLite, máy in thật và sync
Cloud vẫn đang theo lộ trình P1/P2.

```bash
# 1. Hạ tầng dev (PostgreSQL + Redis + Adminer)
#    Migration và seed tự chạy khi container khởi tạo lần đầu.
docker compose -f docker-compose.dev.yml up -d

# 2. Database local cho NinoPOS
sqlite3 ninopos.db < database/sqlite/migrations/V001__init_schema.sql
sqlite3 ninopos.db < database/sqlite/migrations/V002__sync_cdc_triggers.sql

# 3. VIỆC ĐẦU TIÊN — xác nhận bản C# khớp bản TypeScript
cd apps/nino-pos && dotnet test        # 30+ test VietQR phải PASS
cd ../nino-cloud && npm ci && npm test # 46 test, đã verify PASS

# 4. Sinh cặp khoá License (CHỈ MỘT LẦN, trên máy công ty)
cd tools/license-generator
python ninotek_license.py genkeys --passphrase "<mật khẩu mạnh>"
cp keys/ninotek_public.pem ../../apps/nino-pos/src/Ninotek.POS.Licensing/Keys/
```

> ⚠️ Bước 3 quan trọng: mã C# **chưa được biên dịch** trong quá trình khởi tạo
> dự án (môi trường không cài được .NET SDK). Xem
> [`docs/01-VERIFICATION-REPORT.md`](docs/01-VERIFICATION-REPORT.md) mục 4.

## Tài liệu

### Ma trận quyền

| Vai trò | NinoPOS | NinoOrder | NinoDash | Báo cáo doanh thu |
|---|---|---|---|---|
| `OWNER` / `ADMIN` | Toàn quyền | Toàn quyền | Toàn quyền | Có |
| `CASHIER` | Mở/đóng ca, tạo đơn, nhận tiền, in bill, giảm giá trong hạn mức | Không | Không | Không |
| `WAITER` | Không | Xem bàn, đặt món, chuyển bàn, gửi bếp | Không | Không |
| `KITCHEN` / `KITCHEN_STAFF` | KDS, cập nhật trạng thái chế biến | Không | Không | Không |

LAN API bắt buộc Bearer device token sau pairing. `TABLET` được cấp quyền
Waiter, `KDS` được cấp quyền Kitchen; server không tin `userId` hoặc role gửi
trong request body/header. Cloud dùng JWT + role guard cho login, VietQR,
sync và dashboard.

| Tài liệu | Nội dung |
|---|---|
| [`docs/00-ARCHITECTURE.md`](docs/00-ARCHITECTURE.md) | Quyết định kiến trúc (ADR), sơ đồ luồng dữ liệu, cấu trúc monorepo đầy đủ |
| [`docs/01-VERIFICATION-REPORT.md`](docs/01-VERIFICATION-REPORT.md) | **Đọc trước khi code**: 6 lỗi thật đã phát hiện, kết quả kiểm thử, giới hạn đã biết |
| [`database/README.md`](database/README.md) | Schema, ánh xạ kiểu dữ liệu, cơ chế CDC & Optimistic Locking |
| [`packages/api-contracts/openapi.yaml`](packages/api-contracts/openapi.yaml) | Hợp đồng REST — nguồn sinh code cho client C# và Dart |
| [`packages/api-contracts/asyncapi.yaml`](packages/api-contracts/asyncapi.yaml) | Hợp đồng WebSocket — 4 kênh, 10 loại sự kiện |
| [`packages/design-tokens/tokens.json`](packages/design-tokens/tokens.json) | Design System — nguồn sự thật duy nhất cho màu, font, touch target |
| [`resources/workflow/`](resources/workflow/) | Tài liệu nghiệp vụ gốc (SRS, VietQR, License, đóng gói) |

## Tài nguyên dùng chung

| Tài nguyên | Mô tả |
|---|---|
| [`packages/api-contracts/data/vietqr-test-vectors.json`](packages/api-contracts/data/vietqr-test-vectors.json) | 15 golden vector + 7 ca lỗi + 6 ca webhook. **Mọi implementation phải pass 100%** |
| [`packages/api-contracts/data/napas-bank-bins.json`](packages/api-contracts/data/napas-bank-bins.json) | 65 ngân hàng NAPAS (42 nhận được tiền VietQR) — dùng đổ danh sách trong Cài đặt |
| [`tools/vietqr-reference/`](tools/vietqr-reference/) | Bản tham chiếu VietQR bằng Python — chuẩn để đối chiếu khi C#/TS lệch nhau |
| [`tools/license-generator/`](tools/license-generator/) | Công cụ cấp License Key Ed25519 cho bộ phận Sales |
| [`tools/scripts/gen-tokens.js`](tools/scripts/gen-tokens.js) | Sinh XAML (WPF) + Dart (Flutter) + TS từ `tokens.json` |

## Ba nguyên tắc bất di bất dịch

1. **Một nguồn sự thật cho schema** — sửa ở `database/postgres/` trước, mirror sang `database/sqlite/` cùng số hiệu `Vxxx`, trong cùng một Pull Request.
2. **Một nguồn sự thật cho Design System** — không hard-code mã màu HEX trong `.xaml` hay `.dart`. Mọi giá trị lấy từ `tokens.json`.
3. **Một nguồn sự thật cho API** — `packages/api-contracts/openapi.yaml`. Client C# và Dart đều sinh code từ đây.

## Ràng buộc thiết kế bắt buộc

- **UUID v4** cho mọi khoá chính giao dịch (`orders`, `order_details`, `payments`, `stock_transactions`) — sinh offline không trùng.
- **Touch target ≥ 48×48 dp** cho mọi phần tử bấm được trên POS và tablet.
- **Không xoá cứng** — dùng `deleted_at` để sync hai chiều không mất vết.
- **Offline-first** — mất Internet vẫn bán hàng và in bill bình thường qua LAN; mất LAN thì NinoOrder đệm đơn cục bộ và tự kết nối lại mỗi 3 giây.

## Trạng thái dự án

**P0 — Nền móng: HOÀN THÀNH**

- [x] Kiến trúc monorepo + 10 quyết định kiến trúc (ADR)
- [x] DDL PostgreSQL + SQLite, kiểm thử nghiệp vụ end-to-end trên cả hai
- [x] Design tokens + generator sinh XAML/Dart/TS
- [x] OpenAPI 3.1 (15 endpoint) + AsyncAPI 3.0 (4 kênh, 10 sự kiện) — lint sạch
- [x] Lõi VietQR EMVCo + CRC-16, đối chứng 5.009 ca với thư viện độc lập
- [x] Golden test vectors dùng chung cho C# / TypeScript / Dart
- [x] Dữ liệu 65 ngân hàng NAPAS
- [x] Công cụ cấp License Ed25519 — 11/11 kịch bản tấn công bị chặn
- [x] ESC/POS builder + lệnh mở két RJ11, layout 48 cột đã kiểm chứng
- [x] CI 5 cổng chặn + docker-compose môi trường dev

**Tiếp theo**

- [ ] **P1** — LAN API (`/lan/order/create`), sơ đồ bàn WPF, in ESC/POS thực tế, NinoOrder Flutter
- [ ] **P2** — NinoCloud backend, sync worker FIFO, webhook HMAC, NinoDash
- [ ] **P3** — Inno Setup `.exe`, build `.apk`/`.ipa`, kiểm thử tại quán thật

---

© Ninotek — Công nghệ & Giải pháp số. Phần mềm độc quyền.
