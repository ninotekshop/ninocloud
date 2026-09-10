-- =====================================================================
--  NINOTEK F&B POS  —  LOCAL DATABASE SCHEMA (SQLite 3.38+)
--  Migration : V001__init_schema.sql
--  Chạy trên : Máy trạm NinoPOS (Windows) — chế độ Offline-First
--
--  QUY ƯỚC ÁNH XẠ KIỂU DỮ LIỆU so với bản PostgreSQL:
--    UUID        -> TEXT   (chuỗi UUID v4 chữ thường, sinh bởi Guid.NewGuid())
--    TIMESTAMPTZ -> TEXT   (ISO-8601 UTC: '2026-09-03T08:15:30.123Z')
--    NUMERIC     -> NUMERIC
--    ENUM        -> TEXT + CHECK constraint
--    JSONB       -> TEXT   (JSON string, đọc bằng hàm json_* của SQLite)
--    BIGSERIAL   -> INTEGER PRIMARY KEY AUTOINCREMENT
-- =====================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;        -- cho phép đọc song song khi LanServer đang ghi
PRAGMA synchronous  = NORMAL;     -- cân bằng an toàn/tốc độ cho máy POS
PRAGMA busy_timeout = 5000;

BEGIN TRANSACTION;

-- =====================================================================
-- NHÓM A — CỬA HÀNG & NGƯỜI DÙNG
-- =====================================================================

-- Máy POS local chỉ phục vụ 1 cửa hàng; bảng này giữ đúng 1 dòng
CREATE TABLE stores (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT    NOT NULL,
    code              TEXT    NOT NULL,
    name              TEXT    NOT NULL,
    address           TEXT,
    phone             TEXT,
    timezone          TEXT    NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    currency          TEXT    NOT NULL DEFAULT 'VND',
    bank_acq_id       TEXT,
    bank_account_no   TEXT,
    bank_account_name TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version       INTEGER NOT NULL DEFAULT 1,
    deleted_at        TEXT
);

CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    store_id        TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    username        TEXT    NOT NULL,
    full_name       TEXT    NOT NULL,
    password_hash   TEXT    NOT NULL,
    pin_hash        TEXT,
    role            TEXT    NOT NULL DEFAULT 'WAITER'
        CHECK (role IN ('OWNER','ADMIN','CASHIER','WAITER','KITCHEN')),
    phone           TEXT,
    max_discount_percent NUMERIC NOT NULL DEFAULT 0
        CHECK (max_discount_percent BETWEEN 0 AND 100),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    last_login_at   TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version     INTEGER NOT NULL DEFAULT 1,
    deleted_at      TEXT,
    UNIQUE (store_id, username)
);

CREATE TABLE devices (
    id            TEXT PRIMARY KEY,
    store_id      TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    device_name   TEXT    NOT NULL,
    device_type   TEXT    NOT NULL DEFAULT 'TABLET'
        CHECK (device_type IN ('POS','TABLET','PHONE','KDS')),
    machine_code  TEXT,
    push_token    TEXT,
    pairing_token TEXT,                       -- token bắt tay LAN giữa NinoOrder và NinoPOS
    last_seen_at  TEXT,
    is_approved   INTEGER NOT NULL DEFAULT 0 CHECK (is_approved IN (0,1)),
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version   INTEGER NOT NULL DEFAULT 1
);

-- =====================================================================
-- NHÓM B — KHU VỰC & BÀN
-- =====================================================================

CREATE TABLE areas (
    id          TEXT PRIMARY KEY,
    store_id    TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version INTEGER NOT NULL DEFAULT 1,
    deleted_at  TEXT
);

CREATE TABLE tables (
    id                TEXT PRIMARY KEY,
    store_id          TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    area_id           TEXT    NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
    name              TEXT    NOT NULL,
    seat_capacity     INTEGER NOT NULL DEFAULT 4 CHECK (seat_capacity > 0),
    status            TEXT    NOT NULL DEFAULT 'EMPTY'
        CHECK (status IN ('EMPTY','OCCUPIED','RESERVED','BILLING','LOCKED')),
    current_order_id  TEXT,                   -- FK logic tới orders(id), không ràng buộc cứng để tránh vòng
    pos_x             INTEGER NOT NULL DEFAULT 0,
    pos_y             INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    locked_by_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
    locked_at         TEXT,                   -- soft-lock 30s chống 2 nhân viên cùng thao tác
    is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version       INTEGER NOT NULL DEFAULT 1,
    deleted_at        TEXT,
    UNIQUE (store_id, name)
);

-- =====================================================================
-- NHÓM C — THỰC ĐƠN, TOPPING & ĐỊNH LƯỢNG
-- =====================================================================

CREATE TABLE categories (
    id          TEXT PRIMARY KEY,
    store_id    TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    color_code  TEXT    NOT NULL DEFAULT '#007AFF',
    icon        TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version INTEGER NOT NULL DEFAULT 1,
    deleted_at  TEXT
);

CREATE TABLE items (
    id                  TEXT PRIMARY KEY,
    store_id            TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id         TEXT    NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    sku                 TEXT,
    name                TEXT    NOT NULL,
    description         TEXT,
    base_price          NUMERIC NOT NULL CHECK (base_price >= 0),
    cost_price          NUMERIC NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    unit                TEXT    NOT NULL DEFAULT 'Ly',
    image_url           TEXT,
    image_local_path    TEXT,                 -- ảnh cache trên ổ đĩa máy POS
    print_station       TEXT    NOT NULL DEFAULT 'KITCHEN',
    preparation_minutes INTEGER NOT NULL DEFAULT 5,
    is_available        INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version         INTEGER NOT NULL DEFAULT 1,
    deleted_at          TEXT,
    UNIQUE (store_id, sku)
);

CREATE TABLE toppings (
    id          TEXT PRIMARY KEY,
    store_id    TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    extra_price NUMERIC NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
    group_name  TEXT    NOT NULL DEFAULT 'TOPPING',
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version INTEGER NOT NULL DEFAULT 1,
    deleted_at  TEXT
);

CREATE TABLE item_toppings (
    item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    topping_id TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    PRIMARY KEY (item_id, topping_id)
);

CREATE TABLE ingredients (
    id              TEXT PRIMARY KEY,
    store_id        TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    unit            TEXT    NOT NULL,
    stock_quantity  NUMERIC NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC NOT NULL DEFAULT 0 CHECK (min_stock_alert >= 0),
    avg_unit_cost   NUMERIC NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version     INTEGER NOT NULL DEFAULT 1,
    deleted_at      TEXT,
    UNIQUE (store_id, name)
);

CREATE TABLE recipe_items (
    id                TEXT PRIMARY KEY,
    item_id           TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ingredient_id     TEXT    NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity_required NUMERIC NOT NULL CHECK (quantity_required > 0),
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version       INTEGER NOT NULL DEFAULT 1,
    UNIQUE (item_id, ingredient_id)
);

-- =====================================================================
-- NHÓM D — CA LÀM VIỆC
-- =====================================================================

CREATE TABLE shifts (
    id                     TEXT PRIMARY KEY,
    store_id               TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    opened_by_user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    closed_by_user_id      TEXT    REFERENCES users(id) ON DELETE SET NULL,
    status                 TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    opening_cash           NUMERIC NOT NULL DEFAULT 0,
    closing_cash_counted   NUMERIC,
    closing_cash_expected  NUMERIC,
    cash_difference        NUMERIC GENERATED ALWAYS AS
        (COALESCE(closing_cash_counted,0) - COALESCE(closing_cash_expected,0)) STORED,
    total_revenue          NUMERIC NOT NULL DEFAULT 0,
    total_orders           INTEGER NOT NULL DEFAULT 0,
    opened_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    closed_at              TEXT,
    note                   TEXT,
    created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version            INTEGER NOT NULL DEFAULT 1
);
-- Mỗi cửa hàng chỉ 1 ca OPEN tại một thời điểm
CREATE UNIQUE INDEX uq_shifts_one_open_per_store ON shifts (store_id) WHERE status = 'OPEN';

-- =====================================================================
-- NHÓM E — ĐƠN HÀNG
-- =====================================================================

CREATE TABLE orders (
    id                   TEXT PRIMARY KEY,      -- UUID v4 sinh offline bởi POS/Tablet
    store_id             TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_code           TEXT    NOT NULL,      -- NINOPOS100234 -> addInfo VietQR
    table_id             TEXT    REFERENCES tables(id) ON DELETE SET NULL,
    shift_id             TEXT    REFERENCES shifts(id) ON DELETE SET NULL,
    user_id              TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    cashier_id           TEXT    REFERENCES users(id) ON DELETE SET NULL,
    device_id            TEXT    REFERENCES devices(id) ON DELETE SET NULL,
    order_type           TEXT    NOT NULL DEFAULT 'DINE_IN'
        CHECK (order_type IN ('DINE_IN','TAKE_AWAY','DELIVERY')),
    status               TEXT    NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('DRAFT','PENDING','SERVING','COMPLETED','CANCELLED')),
    guest_count          INTEGER NOT NULL DEFAULT 1 CHECK (guest_count > 0),
    customer_name        TEXT,
    customer_phone       TEXT,
    subtotal             NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount      NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    discount_reason      TEXT,
    service_fee          NUMERIC NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    vat_amount           NUMERIC NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    final_total          NUMERIC NOT NULL DEFAULT 0 CHECK (final_total >= 0),
    paid_amount          NUMERIC NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    note                 TEXT,
    cancel_reason        TEXT,
    cancelled_by_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
    merged_into_order_id TEXT    REFERENCES orders(id) ON DELETE SET NULL,
    is_printed           INTEGER NOT NULL DEFAULT 0 CHECK (is_printed IN (0,1)),
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at         TEXT,
    updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version          INTEGER NOT NULL DEFAULT 1,
    deleted_at           TEXT,
    UNIQUE (store_id, order_code),
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE TABLE order_details (
    id                   TEXT PRIMARY KEY,
    order_id             TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id              TEXT    NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    item_name_snapshot   TEXT    NOT NULL,
    quantity             NUMERIC NOT NULL CHECK (quantity > 0),
    price                NUMERIC NOT NULL CHECK (price >= 0),
    topping_total        NUMERIC NOT NULL DEFAULT 0 CHECK (topping_total >= 0),
    discount_amount      NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_total           NUMERIC GENERATED ALWAYS AS
        (quantity * (price + topping_total) - discount_amount) STORED,
    note                 TEXT,
    kitchen_status       TEXT    NOT NULL DEFAULT 'WAITING'
        CHECK (kitchen_status IN ('WAITING','COOKING','READY','SERVED','CANCELLED')),
    printed_at           TEXT,
    served_at            TEXT,
    cancelled_by_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
    cancel_reason        TEXT,
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE order_detail_toppings (
    id                    TEXT PRIMARY KEY,
    order_detail_id       TEXT    NOT NULL REFERENCES order_details(id) ON DELETE CASCADE,
    topping_id            TEXT    NOT NULL REFERENCES toppings(id) ON DELETE RESTRICT,
    topping_name_snapshot TEXT    NOT NULL,
    extra_price           NUMERIC NOT NULL DEFAULT 0,
    quantity              INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =====================================================================
-- NHÓM F — THANH TOÁN & VIETQR
-- =====================================================================

CREATE TABLE payments (
    id                 TEXT PRIMARY KEY,
    store_id           TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id           TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    shift_id           TEXT    REFERENCES shifts(id) ON DELETE SET NULL,
    payment_method     TEXT    NOT NULL
        CHECK (payment_method IN ('CASH','VIETQR','CARD','EWALLET','DEBT','VOUCHER')),
    status             TEXT    NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SUCCESS','FAILED','REFUNDED','EXPIRED')),
    amount             NUMERIC NOT NULL CHECK (amount > 0),
    received_amount    NUMERIC,
    change_amount      NUMERIC NOT NULL DEFAULT 0,
    transaction_ref    TEXT,
    gateway            TEXT,
    paid_at            TEXT,
    created_by_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version        INTEGER NOT NULL DEFAULT 1
);
-- Idempotency: webhook ngân hàng bắn lại không tạo bản ghi trùng
CREATE UNIQUE INDEX uq_payments_gateway_txnref
    ON payments (gateway, transaction_ref) WHERE transaction_ref IS NOT NULL;

CREATE TABLE payment_qr_sessions (
    id            TEXT PRIMARY KEY,
    store_id      TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id      TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_id    TEXT    REFERENCES payments(id) ON DELETE SET NULL,
    account_no    TEXT    NOT NULL,
    account_name  TEXT    NOT NULL,
    acq_id        TEXT    NOT NULL,
    amount        NUMERIC NOT NULL CHECK (amount > 0),
    add_info      TEXT    NOT NULL,
    qr_code_raw   TEXT,
    qr_data_url   TEXT,
    status        TEXT    NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SUCCESS','FAILED','REFUNDED','EXPIRED')),
    expires_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes')),
    confirmed_at  TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    row_version   INTEGER NOT NULL DEFAULT 1
);

-- =====================================================================
-- NHÓM G — KHO & NHẬT KÝ THAO TÁC
-- =====================================================================

CREATE TABLE stock_transactions (
    id              TEXT PRIMARY KEY,
    store_id        TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ingredient_id   TEXT    NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    txn_type        TEXT    NOT NULL
        CHECK (txn_type IN ('IMPORT','CONSUME','WASTE','ADJUST','RETURN')),
    quantity_change NUMERIC NOT NULL,
    quantity_after  NUMERIC NOT NULL,
    unit_cost       NUMERIC NOT NULL DEFAULT 0,
    order_id        TEXT    REFERENCES orders(id) ON DELETE SET NULL,
    user_id         TEXT    REFERENCES users(id) ON DELETE SET NULL,
    note            TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_logs (
    id          TEXT PRIMARY KEY,
    store_id    TEXT    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id     TEXT    REFERENCES users(id) ON DELETE SET NULL,
    shift_id    TEXT    REFERENCES shifts(id) ON DELETE SET NULL,
    action      TEXT    NOT NULL,           -- CANCEL_ITEM, APPLY_DISCOUNT, OPEN_DRAWER, VOID_BILL
    entity_type TEXT    NOT NULL,
    entity_id   TEXT,
    old_value   TEXT,                       -- JSON
    new_value   TEXT,                       -- JSON
    ip_address  TEXT,
    device_id   TEXT    REFERENCES devices(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =====================================================================
-- NHÓM H — HÀNG ĐỢI ĐỒNG BỘ (trái tim của Offline-First)
-- =====================================================================

CREATE TABLE sync_queue (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,   -- thứ tự FIFO tuyệt đối
    store_id           TEXT    NOT NULL,
    entity_type        TEXT    NOT NULL,
    entity_id          TEXT    NOT NULL,
    operation          TEXT    NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    payload            TEXT    NOT NULL,                    -- JSON
    status             TEXT    NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PROCESSING','SYNCED','FAILED','CONFLICT')),
    retry_count        INTEGER NOT NULL DEFAULT 0,
    last_error         TEXT,
    source_device_id   TEXT,
    source_row_version INTEGER,
    source_updated_at  TEXT,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    synced_at          TEXT,
    updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sync_queue_pending ON sync_queue (store_id, id) WHERE status IN ('PENDING','FAILED');
CREATE INDEX idx_sync_queue_entity  ON sync_queue (entity_type, entity_id);

-- Hàng đợi lệnh in — bảo đảm không mất phiếu bếp khi máy in tạm mất kết nối
CREATE TABLE print_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id     TEXT    NOT NULL,
    job_type     TEXT    NOT NULL CHECK (job_type IN ('BILL','KITCHEN_TICKET','SHIFT_REPORT','DRAWER_OPEN')),
    printer_name TEXT    NOT NULL,
    order_id     TEXT,
    payload      TEXT    NOT NULL,          -- chuỗi lệnh ESC/POS đã dựng sẵn (base64)
    status       TEXT    NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PRINTING','DONE','FAILED')),
    retry_count  INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    printed_at   TEXT
);
CREATE INDEX idx_print_jobs_pending ON print_jobs (id) WHERE status IN ('PENDING','FAILED');

-- =====================================================================
-- NHÓM I — CẤU HÌNH CỤC BỘ & BẢN QUYỀN
-- =====================================================================

CREATE TABLE app_settings (
    key         TEXT PRIMARY KEY,           -- printer.bill.port, drawer.open_code, lan.port ...
    value       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE license_local (
    id               INTEGER PRIMARY KEY CHECK (id = 1),   -- chỉ 1 dòng duy nhất
    license_key      TEXT,
    machine_id       TEXT NOT NULL,
    package_type     TEXT CHECK (package_type IN ('TRIAL','BASIC','PRO','ENTERPRISE','LIFETIME')),
    max_devices      INTEGER NOT NULL DEFAULT 3,
    expiry_date      TEXT,
    activated_at     TEXT,
    last_verified_at TEXT,                  -- mốc đối chiếu chống lùi giờ Windows
    is_valid         INTEGER NOT NULL DEFAULT 0 CHECK (is_valid IN (0,1))
);

CREATE TABLE order_sequences (
    store_id    TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    prefix      TEXT    NOT NULL DEFAULT 'NINOPOS',
    last_number INTEGER NOT NULL DEFAULT 100000
);

-- =====================================================================
-- CHỈ MỤC HIỆU NĂNG
-- =====================================================================
CREATE INDEX idx_users_store_role      ON users (store_id, role) WHERE deleted_at IS NULL;
CREATE INDEX idx_areas_store_sort      ON areas (store_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_tables_area_status    ON tables (area_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_store_category  ON items (store_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_name            ON items (name);
CREATE INDEX idx_orders_store_created  ON orders (store_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_status         ON orders (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_table_open     ON orders (table_id) WHERE status IN ('PENDING','SERVING');
CREATE INDEX idx_orders_shift          ON orders (shift_id);
CREATE INDEX idx_order_details_order   ON order_details (order_id);
CREATE INDEX idx_order_details_kitchen ON order_details (kitchen_status, created_at)
    WHERE kitchen_status IN ('WAITING','COOKING');
CREATE INDEX idx_order_details_item    ON order_details (item_id);
CREATE INDEX idx_payments_order        ON payments (order_id);
CREATE INDEX idx_qr_sessions_order     ON payment_qr_sessions (order_id, status);
CREATE INDEX idx_stock_txn_ingredient  ON stock_transactions (ingredient_id, created_at DESC);
CREATE INDEX idx_audit_logs_action     ON audit_logs (action, created_at DESC);

COMMIT;

-- =====================================================================
-- KẾT THÚC V001 (SQLite)
-- =====================================================================
