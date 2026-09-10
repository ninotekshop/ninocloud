# NINOTEK F&B POS — Database

Thư mục này là **nguồn sự thật duy nhất** cho schema của toàn hệ thống. EF Core Migration của NinoPOS và Prisma schema của nino-cloud đều *sinh ra từ* đây — không sửa tay ở hai nơi.

## Cấu trúc

```
database/
├── postgres/migrations/     # Cloud (PostgreSQL 14+)
│   ├── V001__init_schema.sql        # 24 bảng, 4 view, ENUM, index
│   └── V002__sync_cdc_triggers.sql  # CDC, trừ kho tự động, sinh mã hoá đơn
├── sqlite/migrations/       # Local trên máy NinoPOS (SQLite 3.38+)
│   ├── V001__init_schema.sql        # bản mirror 1-1
│   └── V002__sync_cdc_triggers.sql
├── seed/
│   └── V900__seed_demo_data.sql     # dữ liệu demo quán cà phê (chỉ DEV)
└── README.md
```

## Chạy migration

**PostgreSQL (Cloud)**

```bash
createdb ninotek
psql -d ninotek -v ON_ERROR_STOP=1 -f postgres/migrations/V001__init_schema.sql
psql -d ninotek -v ON_ERROR_STOP=1 -f postgres/migrations/V002__sync_cdc_triggers.sql
psql -d ninotek -v ON_ERROR_STOP=1 -f seed/V900__seed_demo_data.sql   # tuỳ chọn
```

**SQLite (máy POS)**

```bash
sqlite3 ninopos.db < sqlite/migrations/V001__init_schema.sql
sqlite3 ninopos.db < sqlite/migrations/V002__sync_cdc_triggers.sql
```

Bộ cài Inno Setup gọi hai lệnh trên trong bước post-install để tạo `%ProgramData%\Ninotek\NinoPOS\ninopos.db`.

## Bảng ánh xạ kiểu dữ liệu

| PostgreSQL (Cloud) | SQLite (Local) | Ghi chú |
|---|---|---|
| `UUID` | `TEXT` | UUID v4 chữ thường, `Guid.NewGuid().ToString()` |
| `TIMESTAMPTZ` | `TEXT` | ISO-8601 UTC `2026-09-03T08:15:30.123Z` |
| `NUMERIC(14,2)` | `NUMERIC` | Tiền VND — **không dùng** `REAL`/`double` |
| `ENUM` | `TEXT` + `CHECK` | Danh sách giá trị giữ đồng nhất 2 bên |
| `JSONB` | `TEXT` | Đọc bằng hàm `json_*` |
| `BIGSERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `sync_queue.id`, `print_jobs.id` |
| `GENERATED ... STORED` | `GENERATED ... STORED` | `line_total`, `cash_difference` |

## Ba cơ chế cốt lõi

### 1. Optimistic Locking — chống 2 nhân viên cùng sửa 1 bàn

Mọi bảng nghiệp vụ có cặp `updated_at` + `row_version`. Trigger tự tăng `row_version` mỗi lần UPDATE. Client gửi kèm `row_version` đọc được lúc đầu:

```sql
UPDATE orders SET status = 'SERVING'
WHERE id = :id AND row_version = :client_row_version;
-- Nếu affected rows = 0 -> có người khác đã sửa -> trả HTTP 409 Conflict
```

Bổ sung lớp thứ hai: `tables.locked_by_user_id` + `locked_at` (soft-lock TTL 30 giây) để NinoOrder chiếm quyền thao tác bàn trước khi mở màn hình chọn món.

### 2. CDC → `sync_queue` — Offline-First

Trigger ở **tầng database** ghi vết mọi INSERT/UPDATE/DELETE trên các bảng giao dịch. Application code không thể "quên" gọi.

```sql
-- Worker (Windows Service) đọc theo FIFO tuyệt đối
SELECT * FROM sync_queue
WHERE store_id = :store AND status IN ('PENDING','FAILED')
ORDER BY id ASC LIMIT 100;
```

Sau khi Cloud xác nhận: `UPDATE sync_queue SET status='SYNCED', synced_at=... WHERE id IN (...)`.
Thất bại: `retry_count + 1`, backoff luỹ thừa; quá 10 lần → `FAILED` và cảnh báo lên NinoDash.

> **Lưu ý triển khai (SQLite):** trigger CDC trên UPDATE có điều kiện `WHEN NEW.row_version <> OLD.row_version` để chỉ ghi **một** bản ghi mang trạng thái cuối cùng. Không có điều kiện này, trigger cập nhật `updated_at` sẽ kích hoạt lại CDC và làm sync_queue phình gấp đôi.

### 3. Trừ kho định lượng tự động

Khi `orders.status` chuyển sang `COMPLETED`, trigger duyệt `recipe_items`, trừ `ingredients.stock_quantity` và ghi sổ cái `stock_transactions` (`txn_type = 'CONSUME'`). NinoDash đọc `v_low_stock_alerts` để bắn cảnh báo nguyên liệu sắp hết.

## View báo cáo cho NinoDash

| View | Dùng cho |
|---|---|
| `v_daily_revenue` | Card doanh thu real-time + % so với hôm qua |
| `v_top_selling_items` | Bar chart Top 5 món bán chạy |
| `v_low_stock_alerts` | Khối cảnh báo đỏ nguyên vật liệu |
| `v_table_occupancy` | Tỷ lệ lấp đầy bàn + thời gian khách ngồi |

## Quy ước đặt tên migration

`V{số thứ tự 3 chữ số}__{mô tả_snake_case}.sql`

- `V001`–`V899`: thay đổi schema (chạy trên cả 2 nền tảng, cùng số hiệu)
- `V900`+: seed data (chỉ DEV/DEMO, **không** chạy trên production)

Mỗi thay đổi schema bắt đầu ở `postgres/`, sau đó mirror sang `sqlite/` **cùng số hiệu** trong cùng một Pull Request.

## Trạng thái kiểm thử

Cả bốn file migration đã được chạy thật và kiểm tra nghiệp vụ end-to-end (mở ca → order → topping → thanh toán VietQR → chốt đơn):

| Kiểm tra | PostgreSQL 16 | SQLite 3.45 |
|---|---|---|
| Migration chạy không lỗi | ✅ 24 bảng / 4 view / 29 trigger | ✅ 24 bảng / 4 view / 32 trigger |
| Tự tính lại tổng tiền đơn | ✅ 99.000đ | ✅ 99.000đ |
| Trừ kho theo định lượng | ✅ | ✅ (khớp từng số lẻ) |
| Ghi sổ cái `stock_transactions` | ✅ | ✅ |
| Giải phóng bàn khi chốt đơn | ✅ | ✅ |
| `row_version` tự tăng | ✅ | ✅ |
| `sync_queue` FIFO, không trùng | ✅ | ✅ |
| View báo cáo trả đúng số | ✅ | ✅ |
