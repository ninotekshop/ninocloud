-- =====================================================================
--  NINOTEK F&B POS — TRIGGERS NGHIỆP VỤ & CDC (SQLite)
--  Migration : V002__sync_cdc_triggers.sql
--  Phụ thuộc : V001__init_schema.sql
--
--  SQLite không có PL/pgSQL nên mọi logic phải viết tường minh theo bảng.
--  Bộ trigger dưới đây là bản mirror 1-1 của V002 phía PostgreSQL.
-- =====================================================================

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- ---------------------------------------------------------------------
-- 1. TOUCH updated_at + row_version  (nền tảng Optimistic Locking)
--    Điều kiện WHEN ... row_version = OLD.row_version tránh đệ quy vô hạn.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_touch_stores AFTER UPDATE ON stores
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE stores SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_users AFTER UPDATE ON users
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_devices AFTER UPDATE ON devices
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE devices SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                       row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_areas AFTER UPDATE ON areas
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE areas SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_tables AFTER UPDATE ON tables
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE tables SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_categories AFTER UPDATE ON categories
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                          row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_items AFTER UPDATE ON items
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_toppings AFTER UPDATE ON toppings
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE toppings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                        row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_ingredients AFTER UPDATE ON ingredients
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE ingredients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                           row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_recipe_items AFTER UPDATE ON recipe_items
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE recipe_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                            row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_shifts AFTER UPDATE ON shifts
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE shifts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_orders AFTER UPDATE ON orders
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_order_details AFTER UPDATE ON order_details
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE order_details SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                             row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_payments AFTER UPDATE ON payments
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE payments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                        row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_qr_sessions AFTER UPDATE ON payment_qr_sessions
FOR EACH ROW WHEN NEW.row_version = OLD.row_version BEGIN
    UPDATE payment_qr_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                                   row_version = OLD.row_version + 1 WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------
-- 2. CDC — ghi vết vào sync_queue để Windows Service đẩy lên Cloud (FIFO)
-- ---------------------------------------------------------------------

-- ORDERS
CREATE TRIGGER trg_sync_orders_ins AFTER INSERT ON orders BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'orders', NEW.id, 'INSERT',
        json_object('id',NEW.id,'store_id',NEW.store_id,'order_code',NEW.order_code,
            'table_id',NEW.table_id,'shift_id',NEW.shift_id,'user_id',NEW.user_id,
            'cashier_id',NEW.cashier_id,'order_type',NEW.order_type,'status',NEW.status,
            'guest_count',NEW.guest_count,'subtotal',NEW.subtotal,
            'discount_amount',NEW.discount_amount,'service_fee',NEW.service_fee,
            'vat_amount',NEW.vat_amount,'final_total',NEW.final_total,
            'paid_amount',NEW.paid_amount,'note',NEW.note,
            'created_at',NEW.created_at,'completed_at',NEW.completed_at,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

CREATE TRIGGER trg_sync_orders_upd AFTER UPDATE ON orders
FOR EACH ROW WHEN NEW.row_version <> OLD.row_version BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'orders', NEW.id, 'UPDATE',
        json_object('id',NEW.id,'store_id',NEW.store_id,'order_code',NEW.order_code,
            'table_id',NEW.table_id,'shift_id',NEW.shift_id,'status',NEW.status,
            'guest_count',NEW.guest_count,'subtotal',NEW.subtotal,
            'discount_amount',NEW.discount_amount,'discount_reason',NEW.discount_reason,
            'service_fee',NEW.service_fee,'vat_amount',NEW.vat_amount,
            'final_total',NEW.final_total,'paid_amount',NEW.paid_amount,
            'cancel_reason',NEW.cancel_reason,'completed_at',NEW.completed_at,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

-- ORDER_DETAILS
CREATE TRIGGER trg_sync_order_details_ins AFTER INSERT ON order_details BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    SELECT o.store_id, 'order_details', NEW.id, 'INSERT',
        json_object('id',NEW.id,'order_id',NEW.order_id,'item_id',NEW.item_id,
            'item_name_snapshot',NEW.item_name_snapshot,'quantity',NEW.quantity,
            'price',NEW.price,'topping_total',NEW.topping_total,
            'discount_amount',NEW.discount_amount,'line_total',NEW.line_total,
            'note',NEW.note,'kitchen_status',NEW.kitchen_status,
            'created_at',NEW.created_at,'updated_at',NEW.updated_at,
            'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at
    FROM orders o WHERE o.id = NEW.order_id;
END;

CREATE TRIGGER trg_sync_order_details_upd AFTER UPDATE ON order_details
FOR EACH ROW WHEN NEW.row_version <> OLD.row_version BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    SELECT o.store_id, 'order_details', NEW.id, 'UPDATE',
        json_object('id',NEW.id,'order_id',NEW.order_id,'quantity',NEW.quantity,
            'price',NEW.price,'topping_total',NEW.topping_total,
            'discount_amount',NEW.discount_amount,'line_total',NEW.line_total,
            'note',NEW.note,'kitchen_status',NEW.kitchen_status,
            'printed_at',NEW.printed_at,'served_at',NEW.served_at,
            'cancel_reason',NEW.cancel_reason,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at
    FROM orders o WHERE o.id = NEW.order_id;
END;

CREATE TRIGGER trg_sync_order_details_del AFTER DELETE ON order_details BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload)
    SELECT o.store_id, 'order_details', OLD.id, 'DELETE',
           json_object('id',OLD.id,'order_id',OLD.order_id)
    FROM orders o WHERE o.id = OLD.order_id;
END;

-- PAYMENTS
CREATE TRIGGER trg_sync_payments_ins AFTER INSERT ON payments BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'payments', NEW.id, 'INSERT',
        json_object('id',NEW.id,'store_id',NEW.store_id,'order_id',NEW.order_id,
            'shift_id',NEW.shift_id,'payment_method',NEW.payment_method,
            'status',NEW.status,'amount',NEW.amount,
            'received_amount',NEW.received_amount,'change_amount',NEW.change_amount,
            'transaction_ref',NEW.transaction_ref,'gateway',NEW.gateway,
            'paid_at',NEW.paid_at,'created_at',NEW.created_at,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

CREATE TRIGGER trg_sync_payments_upd AFTER UPDATE ON payments
FOR EACH ROW WHEN NEW.row_version <> OLD.row_version BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'payments', NEW.id, 'UPDATE',
        json_object('id',NEW.id,'order_id',NEW.order_id,'status',NEW.status,
            'amount',NEW.amount,'transaction_ref',NEW.transaction_ref,
            'gateway',NEW.gateway,'paid_at',NEW.paid_at,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

-- SHIFTS
CREATE TRIGGER trg_sync_shifts_ins AFTER INSERT ON shifts BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'shifts', NEW.id, 'INSERT',
        json_object('id',NEW.id,'store_id',NEW.store_id,
            'opened_by_user_id',NEW.opened_by_user_id,'status',NEW.status,
            'opening_cash',NEW.opening_cash,'opened_at',NEW.opened_at,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

CREATE TRIGGER trg_sync_shifts_upd AFTER UPDATE ON shifts
FOR EACH ROW WHEN NEW.row_version <> OLD.row_version BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'shifts', NEW.id, 'UPDATE',
        json_object('id',NEW.id,'status',NEW.status,
            'closed_by_user_id',NEW.closed_by_user_id,
            'closing_cash_counted',NEW.closing_cash_counted,
            'closing_cash_expected',NEW.closing_cash_expected,
            'cash_difference',NEW.cash_difference,
            'total_revenue',NEW.total_revenue,'total_orders',NEW.total_orders,
            'closed_at',NEW.closed_at,'updated_at',NEW.updated_at,
            'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

-- STOCK_TRANSACTIONS
CREATE TRIGGER trg_sync_stock_txn_ins AFTER INSERT ON stock_transactions BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload)
    VALUES (NEW.store_id, 'stock_transactions', NEW.id, 'INSERT',
        json_object('id',NEW.id,'store_id',NEW.store_id,
            'ingredient_id',NEW.ingredient_id,'txn_type',NEW.txn_type,
            'quantity_change',NEW.quantity_change,'quantity_after',NEW.quantity_after,
            'unit_cost',NEW.unit_cost,'order_id',NEW.order_id,'user_id',NEW.user_id,
            'note',NEW.note,'created_at',NEW.created_at));
END;

-- AUDIT_LOGS
CREATE TRIGGER trg_sync_audit_ins AFTER INSERT ON audit_logs BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload)
    VALUES (NEW.store_id, 'audit_logs', NEW.id, 'INSERT',
        json_object('id',NEW.id,'store_id',NEW.store_id,'user_id',NEW.user_id,
            'shift_id',NEW.shift_id,'action',NEW.action,
            'entity_type',NEW.entity_type,'entity_id',NEW.entity_id,
            'old_value',NEW.old_value,'new_value',NEW.new_value,
            'created_at',NEW.created_at));
END;

-- TABLES (trạng thái bàn — NinoDash dùng để tính tỷ lệ lấp đầy)
CREATE TRIGGER trg_sync_tables_upd AFTER UPDATE ON tables
FOR EACH ROW WHEN NEW.row_version <> OLD.row_version BEGIN
    INSERT INTO sync_queue (store_id, entity_type, entity_id, operation, payload,
                            source_row_version, source_updated_at)
    VALUES (NEW.store_id, 'tables', NEW.id, 'UPDATE',
        json_object('id',NEW.id,'store_id',NEW.store_id,'area_id',NEW.area_id,
            'name',NEW.name,'status',NEW.status,'current_order_id',NEW.current_order_id,
            'updated_at',NEW.updated_at,'row_version',NEW.row_version),
        NEW.row_version, NEW.updated_at);
END;

-- ---------------------------------------------------------------------
-- 3. TỰ ĐỘNG TÍNH LẠI TỔNG TIỀN ĐƠN HÀNG
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_recalc_order_ins AFTER INSERT ON order_details BEGIN
    UPDATE orders SET
        subtotal = (SELECT COALESCE(SUM(line_total),0) FROM order_details
                    WHERE order_id = NEW.order_id AND kitchen_status <> 'CANCELLED'),
        final_total = MAX(
            (SELECT COALESCE(SUM(line_total),0) FROM order_details
             WHERE order_id = NEW.order_id AND kitchen_status <> 'CANCELLED')
            - discount_amount + service_fee + vat_amount, 0)
    WHERE id = NEW.order_id;
END;

CREATE TRIGGER trg_recalc_order_upd AFTER UPDATE ON order_details BEGIN
    UPDATE orders SET
        subtotal = (SELECT COALESCE(SUM(line_total),0) FROM order_details
                    WHERE order_id = NEW.order_id AND kitchen_status <> 'CANCELLED'),
        final_total = MAX(
            (SELECT COALESCE(SUM(line_total),0) FROM order_details
             WHERE order_id = NEW.order_id AND kitchen_status <> 'CANCELLED')
            - discount_amount + service_fee + vat_amount, 0)
    WHERE id = NEW.order_id;
END;

CREATE TRIGGER trg_recalc_order_del AFTER DELETE ON order_details BEGIN
    UPDATE orders SET
        subtotal = (SELECT COALESCE(SUM(line_total),0) FROM order_details
                    WHERE order_id = OLD.order_id AND kitchen_status <> 'CANCELLED'),
        final_total = MAX(
            (SELECT COALESCE(SUM(line_total),0) FROM order_details
             WHERE order_id = OLD.order_id AND kitchen_status <> 'CANCELLED')
            - discount_amount + service_fee + vat_amount, 0)
    WHERE id = OLD.order_id;
END;

-- ---------------------------------------------------------------------
-- 4. TRỪ KHO ĐỊNH LƯỢNG + GIẢI PHÓNG BÀN khi đơn chuyển COMPLETED
--    SQLite không có vòng lặp, nhưng INSERT ... SELECT xử lý được theo tập.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_complete_order_stock
AFTER UPDATE OF status ON orders
FOR EACH ROW WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED'
BEGIN
    -- 4a. Ghi sổ cái kho (quantity_after tính trước khi trừ, xem bước 4b)
    INSERT INTO stock_transactions (id, store_id, ingredient_id, txn_type,
                                    quantity_change, quantity_after, order_id, user_id, note)
    SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
           || substr(lower(hex(randomblob(2))),2) || '-a'
           || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
           NEW.store_id, ri.ingredient_id, 'CONSUME',
           -SUM(ri.quantity_required * od.quantity),
           ing.stock_quantity - SUM(ri.quantity_required * od.quantity),
           NEW.id, NEW.cashier_id,
           'Tu dong tru kho theo dinh luong khi chot don ' || NEW.order_code
    FROM order_details od
    JOIN recipe_items ri ON ri.item_id = od.item_id
    JOIN ingredients  ing ON ing.id = ri.ingredient_id
    WHERE od.order_id = NEW.id AND od.kitchen_status <> 'CANCELLED'
    GROUP BY ri.ingredient_id, ing.stock_quantity;

    -- 4b. Trừ tồn kho thực tế
    UPDATE ingredients
       SET stock_quantity = stock_quantity - (
            SELECT COALESCE(SUM(ri.quantity_required * od.quantity), 0)
            FROM order_details od
            JOIN recipe_items ri ON ri.item_id = od.item_id
            WHERE od.order_id = NEW.id
              AND od.kitchen_status <> 'CANCELLED'
              AND ri.ingredient_id = ingredients.id)
     WHERE id IN (
            SELECT ri.ingredient_id FROM order_details od
            JOIN recipe_items ri ON ri.item_id = od.item_id
            WHERE od.order_id = NEW.id AND od.kitchen_status <> 'CANCELLED');

    -- 4c. Giải phóng bàn
    UPDATE tables
       SET status = 'EMPTY', current_order_id = NULL,
           locked_by_user_id = NULL, locked_at = NULL
     WHERE id = NEW.table_id;
END;

CREATE TRIGGER trg_cancel_order_release_table
AFTER UPDATE OF status ON orders
FOR EACH ROW WHEN NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED'
BEGIN
    UPDATE tables
       SET status = 'EMPTY', current_order_id = NULL,
           locked_by_user_id = NULL, locked_at = NULL
     WHERE id = NEW.table_id;
END;

-- ---------------------------------------------------------------------
-- 5. VIEW BÁO CÁO CỤC BỘ (dùng cho màn hình Đóng ca trên NinoPOS)
-- ---------------------------------------------------------------------
CREATE VIEW v_daily_revenue AS
SELECT
    o.store_id,
    date(o.completed_at, '+7 hours')  AS business_date,
    COUNT(*)                          AS total_orders,
    SUM(o.guest_count)                AS total_guests,
    SUM(o.subtotal)                   AS gross_revenue,
    SUM(o.discount_amount)            AS total_discount,
    SUM(o.final_total)                AS net_revenue,
    ROUND(AVG(o.final_total), 0)      AS avg_order_value
FROM orders o
WHERE o.status = 'COMPLETED' AND o.deleted_at IS NULL
GROUP BY o.store_id, business_date;

CREATE VIEW v_top_selling_items AS
SELECT
    o.store_id,
    date(o.completed_at, '+7 hours') AS business_date,
    od.item_id,
    od.item_name_snapshot            AS item_name,
    SUM(od.quantity)                 AS total_quantity,
    SUM(od.line_total)               AS total_revenue
FROM order_details od
JOIN orders o ON o.id = od.order_id
WHERE o.status = 'COMPLETED' AND o.deleted_at IS NULL
  AND od.kitchen_status <> 'CANCELLED'
GROUP BY o.store_id, business_date, od.item_id, od.item_name_snapshot;

CREATE VIEW v_low_stock_alerts AS
SELECT i.store_id, i.id AS ingredient_id, i.name, i.unit,
       i.stock_quantity, i.min_stock_alert,
       ROUND(i.stock_quantity * 100.0 / NULLIF(i.min_stock_alert, 0), 1) AS stock_percent
FROM ingredients i
WHERE i.is_active = 1 AND i.deleted_at IS NULL
  AND i.stock_quantity <= i.min_stock_alert;

CREATE VIEW v_table_occupancy AS
SELECT t.store_id, a.name AS area_name, t.id AS table_id, t.name AS table_name,
       t.status, o.id AS order_id, o.order_code, o.guest_count,
       o.final_total AS running_total, o.created_at AS seated_at,
       CAST((julianday('now') - julianday(o.created_at)) * 1440 AS INTEGER) AS seated_minutes
FROM tables t
JOIN areas a ON a.id = t.area_id
LEFT JOIN orders o ON o.id = t.current_order_id AND o.status IN ('PENDING','SERVING')
WHERE t.deleted_at IS NULL AND t.is_active = 1;

COMMIT;

-- =====================================================================
-- KẾT THÚC V002 (SQLite)
-- =====================================================================
