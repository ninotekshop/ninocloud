-- =====================================================================
--  NINOTEK F&B POS  —  CLOUD DATABASE SCHEMA (PostgreSQL 14+)
--  Migration : V001__init_schema.sql
--  Thương hiệu: Ninotek - Công nghệ & Giải pháp số
--  Ghi chú   : Mọi bảng giao dịch dùng UUID v4 làm PK (sinh offline).
--              Optimistic Locking qua cặp (updated_at, row_version).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- tìm kiếm tên món nhanh

CREATE SCHEMA IF NOT EXISTS nino;
SET search_path TO nino, public;

-- ---------------------------------------------------------------------
-- 0. KIỂU DỮ LIỆU LIỆT KÊ (ENUM)
-- ---------------------------------------------------------------------
CREATE TYPE table_status_enum    AS ENUM ('EMPTY', 'OCCUPIED', 'RESERVED', 'BILLING', 'LOCKED');
CREATE TYPE order_type_enum      AS ENUM ('DINE_IN', 'TAKE_AWAY', 'DELIVERY');
CREATE TYPE order_status_enum    AS ENUM ('DRAFT', 'PENDING', 'SERVING', 'COMPLETED', 'CANCELLED');
CREATE TYPE kitchen_status_enum  AS ENUM ('WAITING', 'COOKING', 'READY', 'SERVED', 'CANCELLED');
CREATE TYPE payment_method_enum  AS ENUM ('CASH', 'VIETQR', 'CARD', 'EWALLET', 'DEBT', 'VOUCHER');
CREATE TYPE payment_status_enum  AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'EXPIRED');
CREATE TYPE sync_status_enum     AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'CONFLICT');
CREATE TYPE sync_operation_enum  AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE user_role_enum       AS ENUM ('OWNER', 'ADMIN', 'CASHIER', 'WAITER', 'KITCHEN');
CREATE TYPE shift_status_enum    AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE stock_txn_type_enum  AS ENUM ('IMPORT', 'CONSUME', 'WASTE', 'ADJUST', 'RETURN');
CREATE TYPE license_pkg_enum     AS ENUM ('TRIAL', 'BASIC', 'PRO', 'ENTERPRISE', 'LIFETIME');
CREATE TYPE license_status_enum  AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED');

-- ---------------------------------------------------------------------
-- 1. HÀM DÙNG CHUNG — tự động cập nhật updated_at + row_version
--    Đây là xương sống của cơ chế Optimistic Locking (mục 4 SRS).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nino.fn_touch_row()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at  := NOW();
    NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION nino.fn_touch_row() IS
'Bump updated_at + row_version mỗi lần UPDATE. Client gửi kèm row_version cũ; nếu lệch -> HTTP 409 Conflict.';

-- =====================================================================
-- NHÓM A — TỔ CHỨC, CỬA HÀNG & NGƯỜI DÙNG
-- =====================================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200)  NOT NULL,
    tax_code        VARCHAR(20),
    phone           VARCHAR(20),
    email           VARCHAR(150),
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1
);
COMMENT ON TABLE tenants IS 'Doanh nghiệp/chủ sở hữu — 1 tenant có thể có nhiều chi nhánh.';

CREATE TABLE stores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code            VARCHAR(20)   NOT NULL,           -- vd: QN01 — dùng làm tiền tố mã hoá đơn
    name            VARCHAR(200)  NOT NULL,
    address         TEXT,
    phone           VARCHAR(20),
    timezone        VARCHAR(50)   NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    currency        CHAR(3)       NOT NULL DEFAULT 'VND',
    -- Cấu hình nhận tiền VietQR của chi nhánh
    bank_acq_id     VARCHAR(10),                      -- BIN ngân hàng, vd 970436 = Vietcombank
    bank_account_no VARCHAR(30),
    bank_account_name VARCHAR(150),
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_stores_tenant_code UNIQUE (tenant_id, code)
);
COMMENT ON COLUMN stores.bank_acq_id IS 'Mã BIN ngân hàng theo chuẩn NAPAS, dùng cho payload VietQR.';

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    username        VARCHAR(50)   NOT NULL,
    full_name       VARCHAR(150)  NOT NULL,
    password_hash   VARCHAR(255)  NOT NULL,           -- bcrypt/argon2
    pin_hash        VARCHAR(255),                     -- PIN 4-6 số đăng nhập nhanh trên POS
    role            user_role_enum NOT NULL DEFAULT 'WAITER',
    phone           VARCHAR(20),
    max_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0   -- định mức giảm giá được phép
        CHECK (max_discount_percent BETWEEN 0 AND 100),
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_users_store_username UNIQUE (store_id, username)
);
COMMENT ON TABLE users IS 'RBAC theo mục 1 SRS: OWNER/ADMIN toàn quyền, CASHIER chỉ NinoPOS, WAITER chỉ NinoOrder, KITCHEN chỉ KDS.';

-- Thiết bị được phép kết nối LAN vào NinoPOS (giới hạn bởi license.max_devices)
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    device_name     VARCHAR(100)  NOT NULL,           -- "Tablet Tầng 1", "POS Quầy chính"
    device_type     VARCHAR(20)   NOT NULL DEFAULT 'TABLET'
        CHECK (device_type IN ('POS', 'TABLET', 'PHONE', 'KDS')),
    machine_code    VARCHAR(255),                     -- fingerprint máy Windows (POS)
    push_token      TEXT,                             -- FCM token cho NinoDash
    last_seen_at    TIMESTAMPTZ,
    is_approved     BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1
);

-- =====================================================================
-- NHÓM B — KHU VỰC & BÀN
-- =====================================================================

CREATE TABLE areas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name            VARCHAR(100)  NOT NULL,           -- Tầng 1, Sân vườn, Phòng VIP
    sort_order      INTEGER       NOT NULL DEFAULT 0,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1,
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE tables (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    area_id           UUID        NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
    name              VARCHAR(50) NOT NULL,           -- "Bàn 01"
    seat_capacity     SMALLINT    NOT NULL DEFAULT 4 CHECK (seat_capacity > 0),
    status            table_status_enum NOT NULL DEFAULT 'EMPTY',
    current_order_id  UUID,                           -- FK gán sau khi tạo bảng orders
    -- Toạ độ trên sơ đồ bàn dạng lưới của NinoPOS
    pos_x             INTEGER     NOT NULL DEFAULT 0,
    pos_y             INTEGER     NOT NULL DEFAULT 0,
    sort_order        INTEGER     NOT NULL DEFAULT 0,
    -- Khoá mềm chống 2 nhân viên thao tác cùng lúc (mục 4 SRS)
    locked_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
    locked_at         TIMESTAMPTZ,
    is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    row_version       INTEGER     NOT NULL DEFAULT 1,
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT uq_tables_store_name UNIQUE (store_id, name)
);
COMMENT ON COLUMN tables.locked_by_user_id IS
'Soft-lock 30 giây. NinoOrder muốn sửa bàn phải chiếm lock trước; hết hạn tự nhả.';

-- =====================================================================
-- NHÓM C — THỰC ĐƠN, TOPPING & ĐỊNH LƯỢNG KHO
-- =====================================================================

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name            VARCHAR(100)  NOT NULL,           -- Cà phê, Trà sữa, Món nhậu
    color_code      VARCHAR(9)    NOT NULL DEFAULT '#007AFF'
        CHECK (color_code ~* '^#[0-9A-F]{6}([0-9A-F]{2})?$'),
    icon            VARCHAR(50),
    sort_order      INTEGER       NOT NULL DEFAULT 0,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1,
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id     UUID          NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    sku             VARCHAR(50),                      -- mã vạch / mã nội bộ
    name            VARCHAR(200)  NOT NULL,
    description     TEXT,
    base_price      NUMERIC(14,2) NOT NULL CHECK (base_price >= 0),
    cost_price      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    unit            VARCHAR(20)   NOT NULL DEFAULT 'Ly',   -- Ly, Dĩa, Chai, Phần
    image_url       TEXT,
    -- Định tuyến in ấn: món này in ra máy in nào (BAR / KITCHEN / GRILL)
    print_station   VARCHAR(20)   NOT NULL DEFAULT 'KITCHEN',
    preparation_minutes SMALLINT  NOT NULL DEFAULT 5,
    is_available    BOOLEAN       NOT NULL DEFAULT TRUE,  -- tạm hết món trong ngày
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    sort_order      INTEGER       NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_items_store_sku UNIQUE (store_id, sku)
);

CREATE TABLE toppings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name            VARCHAR(100)  NOT NULL,           -- Trân châu đen, Thạch dừa, Shot espresso
    extra_price     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
    group_name      VARCHAR(50)   NOT NULL DEFAULT 'TOPPING',  -- TOPPING / SUGAR / ICE / SIZE
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    sort_order      INTEGER       NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version     INTEGER       NOT NULL DEFAULT 1,
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE item_toppings (
    item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    topping_id      UUID NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (item_id, topping_id)
);
COMMENT ON TABLE item_toppings IS 'Món nào được phép chọn topping nào (popup customization trên NinoOrder).';

CREATE TABLE ingredients (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name              VARCHAR(150)  NOT NULL,         -- Hạt cà phê Robusta, Sữa đặc
    unit              VARCHAR(20)   NOT NULL,         -- kg, lít, gói, chai
    stock_quantity    NUMERIC(14,4) NOT NULL DEFAULT 0,
    min_stock_alert   NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (min_stock_alert >= 0),
    avg_unit_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version       INTEGER       NOT NULL DEFAULT 1,
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT uq_ingredients_store_name UNIQUE (store_id, name)
);
COMMENT ON COLUMN ingredients.min_stock_alert IS
'Ngưỡng cảnh báo. Worker sinh alert đẩy push notification lên NinoDash khi stock_quantity <= ngưỡng này.';

CREATE TABLE recipe_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ingredient_id      UUID          NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity_required  NUMERIC(14,4) NOT NULL CHECK (quantity_required > 0),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version        INTEGER       NOT NULL DEFAULT 1,
    CONSTRAINT uq_recipe_item_ingredient UNIQUE (item_id, ingredient_id)
);
COMMENT ON COLUMN recipe_items.quantity_required IS
'Lượng NVL tiêu hao cho 1 đơn vị món, vd 0.0200 kg hạt cafe cho 1 ly. Dùng để trừ kho tự động khi chốt đơn.';

-- =====================================================================
-- NHÓM D — CA LÀM VIỆC
-- =====================================================================

CREATE TABLE shifts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    opened_by_user_id   UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    closed_by_user_id   UUID          REFERENCES users(id) ON DELETE SET NULL,
    status              shift_status_enum NOT NULL DEFAULT 'OPEN',
    opening_cash        NUMERIC(14,2) NOT NULL DEFAULT 0,
    closing_cash_counted   NUMERIC(14,2),             -- tiền đếm thực tế trong két
    closing_cash_expected  NUMERIC(14,2),             -- hệ thống tính ra
    cash_difference     NUMERIC(14,2)
        GENERATED ALWAYS AS (COALESCE(closing_cash_counted,0) - COALESCE(closing_cash_expected,0)) STORED,
    total_revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_orders        INTEGER       NOT NULL DEFAULT 0,
    opened_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    note                TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version         INTEGER       NOT NULL DEFAULT 1
);
-- Mỗi cửa hàng chỉ được mở 1 ca tại một thời điểm
CREATE UNIQUE INDEX uq_shifts_one_open_per_store
    ON shifts (store_id) WHERE status = 'OPEN';

-- =====================================================================
-- NHÓM E — ĐƠN HÀNG
-- =====================================================================

CREATE TABLE orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_code        VARCHAR(30)   NOT NULL,         -- NINOPOS100234 — dùng làm addInfo VietQR
    table_id          UUID          REFERENCES tables(id) ON DELETE SET NULL,
    shift_id          UUID          REFERENCES shifts(id) ON DELETE SET NULL,
    user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    cashier_id        UUID          REFERENCES users(id) ON DELETE SET NULL,
    device_id         UUID          REFERENCES devices(id) ON DELETE SET NULL,
    order_type        order_type_enum   NOT NULL DEFAULT 'DINE_IN',
    status            order_status_enum NOT NULL DEFAULT 'PENDING',
    guest_count       SMALLINT      NOT NULL DEFAULT 1 CHECK (guest_count > 0),
    customer_name     VARCHAR(150),
    customer_phone    VARCHAR(20),

    subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    discount_reason   VARCHAR(200),
    service_fee       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    vat_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    final_total       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (final_total >= 0),
    paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),

    note              TEXT,
    cancel_reason     TEXT,
    cancelled_by_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
    -- Vết gộp/tách bàn
    merged_into_order_id UUID       REFERENCES orders(id) ON DELETE SET NULL,

    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version       INTEGER       NOT NULL DEFAULT 1,
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT uq_orders_store_code UNIQUE (store_id, order_code),
    CONSTRAINT ck_orders_completed_needs_time
        CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);
COMMENT ON COLUMN orders.order_code IS
'Mã hoá đơn dạng {STORE_CODE}{SEQ}, đưa vào Tag 62 nội dung chuyển khoản VietQR để đối soát webhook.';

-- Nay mới gắn được FK vòng tròn tables -> orders
ALTER TABLE tables
    ADD CONSTRAINT fk_tables_current_order
    FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE order_details (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    item_name_snapshot VARCHAR(200) NOT NULL,         -- chốt tên món tại thời điểm order
    quantity          NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
    price             NUMERIC(14,2) NOT NULL CHECK (price >= 0),   -- đơn giá tại thời điểm order
    topping_total     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (topping_total >= 0),
    discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_total        NUMERIC(14,2)
        GENERATED ALWAYS AS (quantity * (price + topping_total) - discount_amount) STORED,
    note              TEXT,                            -- "ít đường", "không cay"
    kitchen_status    kitchen_status_enum NOT NULL DEFAULT 'WAITING',
    printed_at        TIMESTAMPTZ,                     -- đã in phiếu bếp lúc nào
    served_at         TIMESTAMPTZ,
    cancelled_by_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
    cancel_reason     TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version       INTEGER       NOT NULL DEFAULT 1
);

CREATE TABLE order_detail_toppings (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_detail_id    UUID          NOT NULL REFERENCES order_details(id) ON DELETE CASCADE,
    topping_id         UUID          NOT NULL REFERENCES toppings(id) ON DELETE RESTRICT,
    topping_name_snapshot VARCHAR(100) NOT NULL,
    extra_price        NUMERIC(14,2) NOT NULL DEFAULT 0,
    quantity           SMALLINT      NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- NHÓM F — THANH TOÁN & VIETQR
-- =====================================================================

CREATE TABLE payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id          UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    shift_id          UUID          REFERENCES shifts(id) ON DELETE SET NULL,
    payment_method    payment_method_enum NOT NULL,
    status            payment_status_enum NOT NULL DEFAULT 'PENDING',
    amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    received_amount   NUMERIC(14,2),                  -- tiền khách đưa (CASH)
    change_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    transaction_ref   VARCHAR(100),                   -- mã giao dịch ngân hàng (FT2624490182)
    gateway           VARCHAR(50),                    -- Casso / SePay / VietQR_Baokim
    paid_at           TIMESTAMPTZ,
    created_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version       INTEGER       NOT NULL DEFAULT 1
);
-- Chống ghi trùng khi webhook ngân hàng bắn lại (idempotency)
CREATE UNIQUE INDEX uq_payments_gateway_txnref
    ON payments (gateway, transaction_ref)
    WHERE transaction_ref IS NOT NULL;

CREATE TABLE payment_qr_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id          UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_id        UUID          REFERENCES payments(id) ON DELETE SET NULL,
    -- Payload gửi lên POST /api/v1/payments/vietqr/generate
    account_no        VARCHAR(30)   NOT NULL,
    account_name      VARCHAR(150)  NOT NULL,
    acq_id            VARCHAR(10)   NOT NULL,         -- BIN ngân hàng
    amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    add_info          VARCHAR(100)  NOT NULL,         -- = orders.order_code
    -- Kết quả trả về
    qr_code_raw       TEXT,                           -- chuỗi EMVCo 00020101021238...
    qr_data_url       TEXT,                           -- data:image/png;base64,...
    status            payment_status_enum NOT NULL DEFAULT 'PENDING',
    expires_at        TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    confirmed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version       INTEGER       NOT NULL DEFAULT 1
);
COMMENT ON TABLE payment_qr_sessions IS
'Phiên VietQR động. NinoPOS mở WebSocket ws://.../ws/payments?order_id=... và chờ event PAYMENT_SUCCESS.';

CREATE TABLE payment_webhook_logs (
    id                BIGSERIAL PRIMARY KEY,
    store_id          UUID          REFERENCES stores(id) ON DELETE SET NULL,
    gateway           VARCHAR(50)   NOT NULL,
    transaction_id    VARCHAR(100),
    order_code        VARCHAR(30),
    amount            NUMERIC(14,2),
    raw_payload       JSONB         NOT NULL,
    signature         VARCHAR(255),                   -- header X-Signature
    is_signature_valid BOOLEAN      NOT NULL DEFAULT FALSE,
    is_processed      BOOLEAN       NOT NULL DEFAULT FALSE,
    error_message     TEXT,
    received_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE payment_webhook_logs IS
'Lưu nguyên văn mọi IPN từ ngân hàng/Casso/SePay để đối soát và replay khi cần. Verify HMAC-SHA256 trước khi xử lý.';

-- =====================================================================
-- NHÓM G — KHO & LỊCH SỬ THAO TÁC
-- =====================================================================

CREATE TABLE stock_transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ingredient_id     UUID          NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    txn_type          stock_txn_type_enum NOT NULL,
    quantity_change   NUMERIC(14,4) NOT NULL,         -- âm = tiêu hao, dương = nhập
    quantity_after    NUMERIC(14,4) NOT NULL,
    unit_cost         NUMERIC(14,2) NOT NULL DEFAULT 0,
    order_id          UUID          REFERENCES orders(id) ON DELETE SET NULL,
    user_id           UUID          REFERENCES users(id) ON DELETE SET NULL,
    note              TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE stock_transactions IS
'Sổ cái kho. Khi order COMPLETED, hệ thống duyệt recipe_items sinh bản ghi CONSUME cho từng NVL.';

CREATE TABLE audit_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id           UUID          REFERENCES users(id) ON DELETE SET NULL,
    shift_id          UUID          REFERENCES shifts(id) ON DELETE SET NULL,
    action            VARCHAR(50)   NOT NULL,         -- CANCEL_ITEM, APPLY_DISCOUNT, OPEN_DRAWER, VOID_BILL
    entity_type       VARCHAR(50)   NOT NULL,
    entity_id         UUID,
    old_value         JSONB,
    new_value         JSONB,
    ip_address        VARCHAR(45),
    device_id         UUID          REFERENCES devices(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE audit_logs IS
'Nguồn dữ liệu cho khối "Cảnh báo thông minh" trên NinoDash: huỷ món/giảm giá nghi vấn theo ca.';

-- =====================================================================
-- NHÓM H — HÀNG ĐỢI ĐỒNG BỘ (CDC)
-- =====================================================================

CREATE TABLE sync_queue (
    id                BIGSERIAL PRIMARY KEY,          -- BIGINT tăng dần = thứ tự FIFO tuyệt đối
    store_id          UUID          NOT NULL,
    entity_type       VARCHAR(50)   NOT NULL,         -- orders, order_details, payments, ...
    entity_id         UUID          NOT NULL,
    operation         sync_operation_enum NOT NULL,
    payload           JSONB         NOT NULL,
    status            sync_status_enum NOT NULL DEFAULT 'PENDING',
    retry_count       SMALLINT      NOT NULL DEFAULT 0,
    last_error        TEXT,
    source_device_id  UUID,
    -- Optimistic locking khi merge lên Cloud
    source_row_version INTEGER,
    source_updated_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    synced_at         TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sync_queue IS
'Change Data Capture. Worker nền lấy các bản ghi PENDING theo id ASC (FIFO), đẩy batch 100 lên Cloud, đánh dấu SYNCED.';

-- Index quan trọng nhất của toàn hệ thống: worker quét PENDING theo FIFO
CREATE INDEX idx_sync_queue_pending
    ON sync_queue (store_id, id)
    WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX idx_sync_queue_entity ON sync_queue (entity_type, entity_id);

-- =====================================================================
-- NHÓM I — BẢN QUYỀN (LICENSE)
-- =====================================================================

CREATE TABLE licenses (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id          UUID          REFERENCES stores(id) ON DELETE SET NULL,
    license_key       TEXT          NOT NULL UNIQUE,  -- chuỗi "NINO-XXXXX-XXXXX-..."
    machine_id        VARCHAR(255)  NOT NULL,         -- CPU ID + Mainboard SN + MAC (đã hash)
    package_type      license_pkg_enum NOT NULL DEFAULT 'TRIAL',
    max_devices       SMALLINT      NOT NULL DEFAULT 3 CHECK (max_devices > 0),
    status            license_status_enum NOT NULL DEFAULT 'ACTIVE',
    issued_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expiry_date       DATE,                           -- NULL = LIFETIME
    activated_at      TIMESTAMPTZ,
    last_verified_at  TIMESTAMPTZ,                    -- chống khách lùi giờ Windows
    issued_by         VARCHAR(100),                   -- nhân viên Sales cấp key
    note              TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    row_version       INTEGER       NOT NULL DEFAULT 1
);
CREATE INDEX idx_licenses_machine ON licenses (machine_id);

-- =====================================================================
-- CHỈ MỤC HIỆU NĂNG
-- =====================================================================

CREATE INDEX idx_stores_tenant           ON stores (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_store_role        ON users (store_id, role) WHERE deleted_at IS NULL;
CREATE INDEX idx_areas_store_sort        ON areas (store_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_tables_area_status      ON tables (area_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tables_store_status     ON tables (store_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_store_category    ON items (store_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_name_trgm         ON items USING gin (name gin_trgm_ops);
CREATE INDEX idx_ingredients_low_stock   ON ingredients (store_id)
    WHERE stock_quantity <= min_stock_alert AND deleted_at IS NULL;

-- Truy vấn nóng nhất của NinoDash: doanh thu theo ngày
CREATE INDEX idx_orders_store_created    ON orders (store_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_store_status     ON orders (store_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_completed        ON orders (store_id, completed_at DESC) WHERE status = 'COMPLETED';
CREATE INDEX idx_orders_table            ON orders (table_id) WHERE status IN ('PENDING','SERVING');
CREATE INDEX idx_orders_shift            ON orders (shift_id);

CREATE INDEX idx_order_details_order     ON order_details (order_id);
CREATE INDEX idx_order_details_kitchen   ON order_details (kitchen_status, created_at)
    WHERE kitchen_status IN ('WAITING','COOKING');
CREATE INDEX idx_order_details_item      ON order_details (item_id);   -- top món bán chạy

CREATE INDEX idx_payments_order          ON payments (order_id);
CREATE INDEX idx_payments_store_paid     ON payments (store_id, paid_at DESC) WHERE status = 'SUCCESS';
CREATE INDEX idx_qr_sessions_order       ON payment_qr_sessions (order_id, status);
CREATE INDEX idx_webhook_logs_ordercode  ON payment_webhook_logs (order_code, received_at DESC);

CREATE INDEX idx_stock_txn_ingredient    ON stock_transactions (ingredient_id, created_at DESC);
CREATE INDEX idx_audit_logs_store_action ON audit_logs (store_id, action, created_at DESC);

-- =====================================================================
-- TRIGGER updated_at / row_version cho mọi bảng có Optimistic Locking
-- =====================================================================
DO $$
DECLARE
    t TEXT;
    tbls TEXT[] := ARRAY[
        'tenants','stores','users','devices','areas','tables','categories','items',
        'toppings','ingredients','recipe_items','shifts','orders','order_details',
        'payments','payment_qr_sessions','licenses'
    ];
BEGIN
    FOREACH t IN ARRAY tbls LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON nino.%1$I
             FOR EACH ROW EXECUTE FUNCTION nino.fn_touch_row();', t);
    END LOOP;
END $$;

-- =====================================================================
-- VIEW BÁO CÁO CHO NINODASH
-- =====================================================================

CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
    o.store_id,
    (o.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date,
    COUNT(*)                              AS total_orders,
    SUM(o.guest_count)                    AS total_guests,
    SUM(o.subtotal)                       AS gross_revenue,
    SUM(o.discount_amount)                AS total_discount,
    SUM(o.final_total)                    AS net_revenue,
    ROUND(AVG(o.final_total), 0)          AS avg_order_value
FROM orders o
WHERE o.status = 'COMPLETED' AND o.deleted_at IS NULL
GROUP BY o.store_id, business_date;

CREATE OR REPLACE VIEW v_top_selling_items AS
SELECT
    o.store_id,
    (o.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date,
    od.item_id,
    od.item_name_snapshot AS item_name,
    SUM(od.quantity)      AS total_quantity,
    SUM(od.line_total)    AS total_revenue
FROM order_details od
JOIN orders o ON o.id = od.order_id
WHERE o.status = 'COMPLETED'
  AND o.deleted_at IS NULL
  AND od.kitchen_status <> 'CANCELLED'
GROUP BY o.store_id, business_date, od.item_id, od.item_name_snapshot;

CREATE OR REPLACE VIEW v_low_stock_alerts AS
SELECT
    i.store_id, i.id AS ingredient_id, i.name, i.unit,
    i.stock_quantity, i.min_stock_alert,
    ROUND(i.stock_quantity / NULLIF(i.min_stock_alert, 0) * 100, 1) AS stock_percent
FROM ingredients i
WHERE i.is_active AND i.deleted_at IS NULL
  AND i.stock_quantity <= i.min_stock_alert;

CREATE OR REPLACE VIEW v_table_occupancy AS
SELECT
    t.store_id,
    a.name          AS area_name,
    t.id            AS table_id,
    t.name          AS table_name,
    t.status,
    o.id            AS order_id,
    o.order_code,
    o.guest_count,
    o.final_total   AS running_total,
    o.created_at    AS seated_at,
    EXTRACT(EPOCH FROM (NOW() - o.created_at))::INT / 60 AS seated_minutes
FROM tables t
JOIN areas a  ON a.id = t.area_id
LEFT JOIN orders o ON o.id = t.current_order_id AND o.status IN ('PENDING','SERVING')
WHERE t.deleted_at IS NULL AND t.is_active;

COMMIT;

-- =====================================================================
-- KẾT THÚC V001
-- =====================================================================
