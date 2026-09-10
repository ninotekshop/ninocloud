# NINOTEK F&B POS — Kiến trúc Hệ thống & Cấu trúc Monorepo

> **Ninotek — Công nghệ & Giải pháp số**
> Tài liệu kiến trúc gốc (Architecture Baseline) — phiên bản 1.0.0
> Cập nhật: 2026-09-03

---

## 1. Quyết định Kiến trúc đã chốt (ADR — Architecture Decision Records)

| # | Hạng mục | Quyết định | Lý do |
|---|---|---|---|
| ADR-001 | NinoPOS (Windows) | **C# .NET 8 + WPF** | Driver phần cứng native (ESC/POS qua USB/COM/LAN, két RJ11), `System.IO.Ports` ổn định, Windows Service chạy sync nền, ConfuserEx obfuscate, khớp file `NinoPOS_Setup.iss` đã có (`net8.0-windows`) |
| ADR-002 | NinoOrder / NinoDash | **Flutter 3.x (Dart)** | 1 codebase Android + iOS, hiệu năng 60fps trên tablet POS (Sunmi/iMin), widget tuỳ biến sát Design System |
| ADR-003 | Cloud Backend | **NestJS (Node.js + TypeScript)** | Module hoá, WebSocket Gateway, BullMQ + Redis cho hàng đợi sync/webhook, OpenAPI sinh SDK cho Dart & C# |
| ADR-004 | DB Local (POS) | **SQLite (WAL mode)** | Nhúng thẳng vào bộ cài `.exe`, không cần service riêng → kỹ thuật viên cài 1-click tại quán |
| ADR-005 | DB Cloud | **PostgreSQL 16 + Redis 7** | JSONB cho `sync_queue.payload`, native ENUM, partition theo tháng cho `orders` |
| ADR-006 | Khoá chính giao dịch | **UUID v4** | Sinh mã offline độc lập trên POS + nhiều tablet mà không xung đột khi merge lên Cloud |
| ADR-007 | Chống xung đột | **Optimistic Locking** qua `updated_at` + `row_version` | 2 nhân viên cùng thao tác 1 bàn → bản ghi có `row_version` cũ bị từ chối (HTTP 409) |
| ADR-008 | Đồng bộ | **CDC qua trigger DB → `sync_queue` → Worker FIFO** | Không phụ thuộc application code; mọi thay đổi đều được ghi vết ở tầng DB |
| ADR-009 | Bảo mật API | **HTTPS/TLS + JWT ngắn hạn + HMAC-SHA256** cho webhook | Theo mục 3 tài liệu `7. Dong goi & Ban quyen su dung.md` |
| ADR-010 | License | **RSA-2048 PSS chữ ký số bất đối xứng** (Private Key ở Sales Server, Public Key nhúng NinoPOS) | Client không thể tự sinh key giả |

---

## 2. Sơ đồ luồng dữ liệu tổng thể

```
                          ┌────────────────────────────────────────┐
                          │        MẠNG LAN NỘI BỘ TẠI QUÁN        │
                          │                                        │
  ┌──────────────┐  WS/REST  ┌──────────────────────────┐          │
  │  NinoOrder   │◄─────────►│      NinoPOS (Windows)   │          │
  │ (Flutter)    │  < 0.5s   │  ┌────────────────────┐  │          │
  │  Tablet NV   │           │  │ Ninotek.POS.App    │  │  ESC/POS │      ┌─────────────┐
  └──────────────┘           │  │ (WPF UI)           │  ├──────────┼─────►│ Máy in bill │
         ▲                   │  ├────────────────────┤  │  RJ11    │      │  80mm + Két │
         │ auto-reconnect 3s │  │ LanServer(Kestrel) │  │          │      └─────────────┘
         │ + local cache     │  │ :8080 REST + WS    │  │  IP:9100 │      ┌─────────────┐
         ▼                   │  ├────────────────────┤  ├──────────┼─────►│ Máy in Bếp  │
  ┌──────────────┐           │  │ SQLite (WAL)       │  │          │      │  / KDS      │
  │ Local cache  │           │  │ + sync_queue       │  │          │      └─────────────┘
  │ (Hive/Isar)  │           │  ├────────────────────┤  │          │
  └──────────────┘           │  │ SyncWorker Service │  │          │
                             │  └─────────┬──────────┘  │          │
                             └────────────┼─────────────┘          │
                          └───────────────┼────────────────────────┘
                                          │ HTTPS + JWT (FIFO, batch 100)
                                          │ chỉ chạy khi có Internet
                                          ▼
                          ┌────────────────────────────────────────┐
                          │        NINOTEK CLOUD (NestJS)          │
                          │  PostgreSQL 16 │ Redis 7 │ BullMQ      │
                          │  ┌──────────────────────────────────┐  │
   Ngân hàng / NAPAS ────►│  │ POST /payments/vietqr/webhook    │  │
   (Casso / SePay)  IPN   │  │      (verify HMAC-SHA256)        │  │
                          │  └──────────┬───────────────────────┘  │
                          │             │ emit PAYMENT_SUCCESS     │
                          └─────────────┼──────────────┬───────────┘
                                        │ WS           │ FCM Push
                                        ▼              ▼
                                   NinoPOS        ┌──────────────┐
                              (tự chốt bill,      │   NinoDash   │
                               mở két, in bill)   │  (Chủ quán)  │
                                                  └──────────────┘
```

---

## 3. Cấu trúc thư mục Monorepo

```
ninotek-order/
│
├── apps/
│   │
│   ├── nino-pos/                          # ⬛ MODULE 1 — Windows Desktop (C# .NET 8 / WPF)
│   │   ├── Ninotek.POS.sln
│   │   ├── src/
│   │   │   ├── Ninotek.POS.App/           # Tầng trình bày (WPF, MVVM - CommunityToolkit.Mvvm)
│   │   │   │   ├── Views/
│   │   │   │   │   ├── TableMapView.xaml          # Sơ đồ bàn (cột giữa 55%)
│   │   │   │   │   ├── MenuGridView.xaml          # Lưới món có ảnh, touch ≥ 48dp
│   │   │   │   │   ├── OrderCartView.xaml         # Hoá đơn hiện tại (cột phải 25%)
│   │   │   │   │   ├── PaymentDialogView.xaml     # Tiền mặt / VietQR / Thẻ
│   │   │   │   │   ├── VietQrDisplayView.xaml     # Hiển thị QR + đếm ngược + trạng thái WS
│   │   │   │   │   ├── ShiftOpenCloseView.xaml    # Mở ca / Đóng ca / Kiểm kê két
│   │   │   │   │   ├── InventoryView.xaml         # Kho & định lượng
│   │   │   │   │   ├── SettingsPrinterView.xaml   # Cấu hình máy in bill/bếp, két RJ11
│   │   │   │   │   └── LicenseActivationView.xaml # Hiển thị Machine ID + nhập License Key
│   │   │   │   ├── ViewModels/
│   │   │   │   ├── Controls/              # NinoTouchButton, NinoTableCard, NinoNumPad
│   │   │   │   ├── Themes/
│   │   │   │   │   ├── NinotekColors.xaml         # ⇦ sinh tự động từ packages/design-tokens
│   │   │   │   │   ├── NinotekTypography.xaml
│   │   │   │   │   └── NinotekControls.xaml
│   │   │   │   ├── Assets/                # NinoPOS_Icon.ico, logo, ảnh món mặc định
│   │   │   │   └── App.xaml / Program.cs
│   │   │   │
│   │   │   ├── Ninotek.POS.Core/          # Domain thuần — KHÔNG phụ thuộc UI/DB
│   │   │   │   ├── Entities/              # Order, OrderDetail, Table, Item, Recipe...
│   │   │   │   ├── Enums/                 # TableStatus, OrderStatus, KitchenStatus...
│   │   │   │   ├── Abstractions/          # IOrderRepository, IPrinterService, ISyncQueue
│   │   │   │   └── UseCases/
│   │   │   │       ├── CreateOrderUseCase.cs
│   │   │   │       ├── SplitMergeTableUseCase.cs
│   │   │   │       ├── CheckoutOrderUseCase.cs
│   │   │   │       └── DeductIngredientStockUseCase.cs   # trừ kho theo recipe_items
│   │   │   │
│   │   │   ├── Ninotek.POS.Data/          # EF Core 8 + SQLite
│   │   │   │   ├── NinoPosDbContext.cs
│   │   │   │   ├── Configurations/
│   │   │   │   ├── Repositories/
│   │   │   │   └── Migrations/            # ⇦ sinh từ database/sqlite/migrations
│   │   │   │
│   │   │   ├── Ninotek.POS.Hardware/      # Tầng phần cứng
│   │   │   │   ├── Printing/
│   │   │   │   │   ├── EscPosCommandBuilder.cs   # ESC/POS 80mm & 58mm
│   │   │   │   │   ├── UsbPrinterAdapter.cs
│   │   │   │   │   ├── NetworkPrinterAdapter.cs  # IP:9100
│   │   │   │   │   ├── SerialPrinterAdapter.cs   # COM
│   │   │   │   │   └── Templates/                # BillTemplate, KitchenTicketTemplate
│   │   │   │   ├── CashDrawer/CashDrawerRj11.cs  # ESC p 0 25 250
│   │   │   │   ├── BarcodeScanner/
│   │   │   │   └── CustomerDisplay/              # Màn hình phụ hiển thị QR cho khách
│   │   │   │
│   │   │   ├── Ninotek.POS.LanServer/     # Self-host Kestrel phục vụ NinoOrder
│   │   │   │   ├── Controllers/           # /api/v1/lan/order/create, /lan/tables/status
│   │   │   │   ├── Hubs/                  # /ws/lan/kitchen, /ws/lan/tables
│   │   │   │   ├── Discovery/             # mDNS/UDP broadcast để tablet tự tìm IP POS
│   │   │   │   └── Middleware/            # DeviceTokenAuth, OptimisticLockFilter
│   │   │   │
│   │   │   ├── Ninotek.POS.Sync/          # Windows Service — đẩy sync_queue lên Cloud
│   │   │   │   ├── SyncWorker.cs          # FIFO, batch 100, exponential backoff
│   │   │   │   ├── CloudApiClient.cs
│   │   │   │   └── ConnectivityMonitor.cs
│   │   │   │
│   │   │   └── Ninotek.POS.Licensing/
│   │   │       ├── MachineFingerprint.cs  # CPU ID + Mainboard SN + MAC → SHA256
│   │   │       ├── LicenseValidator.cs    # RSA-PSS verify bằng Public Key nhúng
│   │   │       └── Keys/ninotek_public.pem
│   │   │
│   │   ├── tests/
│   │   │   ├── Ninotek.POS.Core.Tests/
│   │   │   └── Ninotek.POS.Hardware.Tests/
│   │   │
│   │   └── installer/
│   │       ├── NinoPOS_Setup.iss          # ⇦ đã có sẵn trong resources/workflow/9
│   │       ├── assets/NinoPOS_Icon.ico
│   │       └── prerequisites/             # dotnet-runtime-8-win-x64.exe
│   │
│   ├── nino-order/                        # ⬛ MODULE 2 — Flutter (Tablet nhân viên)
│   │   ├── pubspec.yaml
│   │   └── lib/
│   │       ├── main.dart
│   │       ├── core/
│   │       │   ├── theme/nino_theme.dart          # ⇦ sinh từ design-tokens
│   │       │   ├── network/lan_client.dart        # HTTP + WebSocket tới NinoPOS
│   │       │   ├── network/reconnect_policy.dart  # auto-retry mỗi 3s
│   │       │   └── di/injector.dart               # get_it
│   │       ├── data/
│   │       │   ├── local/isar_offline_queue.dart  # đệm đơn khi mất LAN
│   │       │   ├── models/
│   │       │   └── repositories/
│   │       ├── domain/
│   │       └── features/
│   │           ├── table_map/          # Sơ đồ bàn theo khu vực, thẻ bàn (số người, thời gian, tạm tính)
│   │           ├── menu_picker/        # Tab vuốt ngang + tìm kiếm nhanh
│   │           ├── item_customize/     # Popup topping, đường/đá, ghi chú
│   │           ├── cart/               # Bottom bar + nút "Gửi Bếp"
│   │           ├── table_actions/      # Chuyển bàn / gộp bàn / tách bàn
│   │           └── connection_banner/  # Banner đỏ "Mất kết nối trạm thu ngân"
│   │
│   ├── nino-dash/                         # ⬛ MODULE 3 — Flutter (Chủ quán)
│   │   └── lib/
│   │       ├── core/                      # theme, cloud_client, fcm_service
│   │       └── features/
│   │           ├── overview/           # Card doanh thu real-time + % so với hôm qua
│   │           ├── charts/             # Line chart doanh thu/giờ, Bar chart top 5 món
│   │           ├── inventory_alert/    # Cảnh báo NVL sắp hết / lãng phí
│   │           ├── shift_audit/        # Lịch sử ca + thao tác huỷ món / giảm giá nghi vấn
│   │           └── branch_switcher/    # Chọn chi nhánh
│   │
│   └── nino-cloud/                        # ⬛ BACKEND — NestJS + PostgreSQL + Redis
│       ├── package.json
│       ├── prisma/schema.prisma           # ⇦ introspect từ database/postgres
│       └── src/
│           ├── main.ts
│           ├── modules/
│           │   ├── auth/                  # JWT, refresh token, RBAC guard
│           │   ├── tenants/               # Cửa hàng / chi nhánh
│           │   ├── sync/                  # POST /cloud/sync/transactions (idempotent theo UUID)
│           │   ├── catalog/               # categories, items, toppings, ingredients
│           │   ├── orders/
│           │   ├── payments/
│           │   │   ├── vietqr.service.ts       # EMVCo builder + CRC-16/CCITT
│           │   │   ├── vietqr.controller.ts    # POST /payments/vietqr/generate
│           │   │   └── webhook.controller.ts   # POST /payments/vietqr/webhook (HMAC)
│           │   ├── realtime/              # WS Gateway: /ws/payments, /ws/cloud/realtime-reports
│           │   ├── reports/               # GET /cloud/reports/dashboard
│           │   ├── licensing/             # cấp & thu hồi License Key, quản lý devices
│           │   └── notifications/         # FCM push tới NinoDash
│           ├── common/                    # filters, interceptors, HMAC guard, pipes
│           └── queues/                    # BullMQ: sync-processor, webhook-processor
│
├── packages/                              # ⬛ TÀI SẢN DÙNG CHUNG (nguồn duy nhất)
│   ├── design-tokens/
│   │   ├── tokens.json                    # ⇦ NGUỒN SỰ THẬT của Design System
│   │   └── build/                         # script sinh: *.xaml (WPF), *.dart (Flutter), *.ts
│   ├── api-contracts/
│   │   ├── openapi.yaml                   # REST — sinh SDK C# (NSwag) + Dart (openapi-generator)
│   │   └── asyncapi.yaml                  # WebSocket events: ORDER_CREATED, PAYMENT_SUCCESS...
│   └── nino_ui_kit/                       # Flutter package: NinoButton, NinoTableCard, NinoStatCard
│
├── database/                              # ⬛ NGUỒN SỰ THẬT CỦA SCHEMA
│   ├── postgres/migrations/
│   │   ├── V001__init_schema.sql
│   │   └── V002__sync_cdc_triggers.sql
│   ├── sqlite/migrations/
│   │   └── V001__init_schema.sql
│   ├── seed/
│   │   └── V900__seed_demo_data.sql
│   └── README.md
│
├── tools/
│   ├── license-generator/                 # Python — công cụ cấp key cho Sales
│   └── scripts/                           # build-all.ps1, gen-tokens.js, db-migrate.sh
│
├── docs/
│   ├── 00-ARCHITECTURE.md                 # (file này)
│   ├── 01-api-reference.md
│   ├── 02-offline-first-playbook.md
│   └── 03-hardware-integration.md
│
├── resources/                             # (đã có) logo, mockup, tài liệu workflow
│
├── .editorconfig
├── .gitignore
└── README.md
```

---

## 4. Nguyên tắc vận hành Monorepo

1. **Một nguồn sự thật cho schema** — mọi thay đổi DB bắt đầu ở `database/postgres/migrations`, sau đó mirror sang `database/sqlite/migrations` cùng số hiệu `Vxxx`. EF Core Migration của NinoPOS và Prisma của nino-cloud đều *sinh ra từ* đây, không sửa tay lệch nhau.
2. **Một nguồn sự thật cho Design System** — `packages/design-tokens/tokens.json`. Không hard-code mã màu HEX trong file `.xaml` hay `.dart`.
3. **Một nguồn sự thật cho API** — `packages/api-contracts/openapi.yaml`. Client C# và Dart đều sinh code từ file này; CI fail nếu code tay lệch contract.
4. **Quy tắc UUID** — mọi bảng giao dịch (`orders`, `order_details`, `payments`, `stock_transactions`, `audit_logs`) dùng UUID v4 sinh phía client. Bảng danh mục (`categories`) có thể dùng INT tăng dần vì chỉ Admin sửa trên 1 máy.
5. **Không bao giờ xoá cứng** — dùng `deleted_at` (soft delete) để sync 2 chiều không mất vết.

---

## 5. Lộ trình triển khai

| Giai đoạn | Thời gian | Nội dung |
|---|---|---|
| **P0 — Nền móng** | Tuần 1–2 | Monorepo, DDL, design tokens, OpenAPI contract, CI/CD |
| **P1 — Core POS** | Tuần 3–6 | NinoPOS bán hàng offline + in bill ESC/POS + két RJ11; NinoOrder kết nối LAN |
| **P2 — Cloud & VietQR** | Tuần 7–9 | NestJS backend, sync worker, VietQR động + webhook, NinoDash báo cáo |
| **P3 — Đóng gói** | Tuần 10+ | License key, Inno Setup `.exe`, build `.apk`/`.ipa`, kiểm thử thực tế tại quán |
