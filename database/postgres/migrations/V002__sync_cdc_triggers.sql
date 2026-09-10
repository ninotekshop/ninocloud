-- =====================================================================
--  NINOTEK F&B POS — CDC TRIGGERS & BUSINESS LOGIC (PostgreSQL)
--  Migration : V002__sync_cdc_triggers.sql
--  Phụ thuộc : V001__init_schema.sql
-- =====================================================================

BEGIN;
SET search_path TO nino, public;

-- ---------------------------------------------------------------------
-- 1. HÀM CDC — mọi thay đổi trên bảng giao dịch đều ghi vết sync_queue
--    Áp dụng ở tầng DB nên không thể "quên" gọi từ application code.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nino.fn_capture_sync()
RETURNS TRIGGER AS $$
DECLARE
    v_store_id UUID;
    v_payload  JSONB;
    v_entity   UUID;
    v_op       nino.sync_operation_enum;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_payload := to_jsonb(OLD);
        v_entity  := OLD.id;
        v_op      := 'DELETE';
    ELSE
        v_payload := to_jsonb(NEW);
        v_entity  := NEW.id;
        v_op      := CASE WHEN TG_OP = 'INSERT' THEN 'INSERT' ELSE 'UPDATE' END;
    END IF;

    -- store_id có thể nằm trực tiếp trên bảng, hoặc phải suy ra từ bảng cha
    IF v_payload ? 'store_id' THEN
        v_store_id := (v_payload ->> 'store_id')::UUID;
    ELSIF v_payload ? 'order_id' THEN
        SELECT o.store_id INTO v_store_id
        FROM nino.orders o WHERE o.id = (v_payload ->> 'order_id')::UUID;
    END IF;

    INSERT INTO nino.sync_queue (
        store_id, entity_type, entity_id, operation, payload,
        source_row_version, source_updated_at
    ) VALUES (
        v_store_id,
        TG_TABLE_NAME,
        v_entity,
        v_op,
        v_payload,
        NULLIF(v_payload ->> 'row_version', '')::INTEGER,
        NULLIF(v_payload ->> 'updated_at', '')::TIMESTAMPTZ
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION nino.fn_capture_sync() IS
'Change Data Capture: ghi mọi INSERT/UPDATE/DELETE vào sync_queue để Worker đẩy lên Cloud theo FIFO.';

-- Gắn trigger CDC cho các bảng giao dịch cần đồng bộ lên Cloud
DO $$
DECLARE
    t TEXT;
    tbls TEXT[] := ARRAY[
        'orders','order_details','order_detail_toppings',
        'payments','payment_qr_sessions',
        'stock_transactions','audit_logs','shifts','tables'
    ];
BEGIN
    FOREACH t IN ARRAY tbls LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_sync_%1$s AFTER INSERT OR UPDATE OR DELETE ON nino.%1$I
             FOR EACH ROW EXECUTE FUNCTION nino.fn_capture_sync();', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. TỰ ĐỘNG TÍNH LẠI TỔNG TIỀN ĐƠN HÀNG khi order_details thay đổi
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nino.fn_recalc_order_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id UUID := COALESCE(NEW.order_id, OLD.order_id);
    v_subtotal NUMERIC(14,2);
BEGIN
    SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
    FROM nino.order_details
    WHERE order_id = v_order_id AND kitchen_status <> 'CANCELLED';

    UPDATE nino.orders
       SET subtotal    = v_subtotal,
           final_total = GREATEST(v_subtotal - discount_amount + service_fee + vat_amount, 0)
     WHERE id = v_order_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_order_totals
AFTER INSERT OR UPDATE OR DELETE ON nino.order_details
FOR EACH ROW EXECUTE FUNCTION nino.fn_recalc_order_totals();

-- ---------------------------------------------------------------------
-- 3. TỰ ĐỘNG TRỪ KHO ĐỊNH LƯỢNG khi đơn hàng chuyển sang COMPLETED
--    (mục "trừ kho định lượng nguyên liệu nội bộ" — tài liệu 2 & 3)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nino.fn_deduct_stock_on_complete()
RETURNS TRIGGER AS $$
DECLARE
    r RECORD;
    v_new_qty NUMERIC(14,4);
BEGIN
    IF NEW.status = 'COMPLETED' AND COALESCE(OLD.status, 'PENDING') <> 'COMPLETED' THEN
        FOR r IN
            SELECT ri.ingredient_id,
                   SUM(ri.quantity_required * od.quantity) AS total_used
            FROM nino.order_details od
            JOIN nino.recipe_items ri ON ri.item_id = od.item_id
            WHERE od.order_id = NEW.id
              AND od.kitchen_status <> 'CANCELLED'
            GROUP BY ri.ingredient_id
        LOOP
            UPDATE nino.ingredients
               SET stock_quantity = stock_quantity - r.total_used
             WHERE id = r.ingredient_id
            RETURNING stock_quantity INTO v_new_qty;

            INSERT INTO nino.stock_transactions (
                store_id, ingredient_id, txn_type, quantity_change,
                quantity_after, order_id, user_id, note
            ) VALUES (
                NEW.store_id, r.ingredient_id, 'CONSUME', -r.total_used,
                v_new_qty, NEW.id, NEW.cashier_id,
                'Tự động trừ kho theo định lượng khi chốt đơn ' || NEW.order_code
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deduct_stock_on_complete
AFTER UPDATE OF status ON nino.orders
FOR EACH ROW EXECUTE FUNCTION nino.fn_deduct_stock_on_complete();

-- ---------------------------------------------------------------------
-- 4. GIẢI PHÓNG BÀN khi đơn hàng hoàn tất hoặc bị huỷ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nino.fn_release_table()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('COMPLETED','CANCELLED')
       AND COALESCE(OLD.status,'PENDING') NOT IN ('COMPLETED','CANCELLED')
       AND NEW.table_id IS NOT NULL THEN
        UPDATE nino.tables
           SET status            = 'EMPTY',
               current_order_id  = NULL,
               locked_by_user_id = NULL,
               locked_at         = NULL
         WHERE id = NEW.table_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_table
AFTER UPDATE OF status ON nino.orders
FOR EACH ROW EXECUTE FUNCTION nino.fn_release_table();

-- ---------------------------------------------------------------------
-- 5. SINH MÃ HOÁ ĐƠN order_code theo từng cửa hàng (dùng cho addInfo VietQR)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_sequences (
    store_id     UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    prefix       VARCHAR(15) NOT NULL DEFAULT 'NINOPOS',
    last_number  BIGINT      NOT NULL DEFAULT 100000
);

CREATE OR REPLACE FUNCTION nino.fn_next_order_code(p_store_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    v_prefix VARCHAR(15);
    v_num    BIGINT;
BEGIN
    INSERT INTO nino.order_sequences (store_id) VALUES (p_store_id)
    ON CONFLICT (store_id) DO NOTHING;

    UPDATE nino.order_sequences
       SET last_number = last_number + 1
     WHERE store_id = p_store_id
    RETURNING prefix, last_number INTO v_prefix, v_num;

    -- Kết quả dạng NINOPOS100234 — chỉ chữ + số, an toàn cho Tag 62 chuẩn EMVCo
    RETURN v_prefix || v_num::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION nino.fn_next_order_code(UUID) IS
'Sinh mã hoá đơn dùng làm nội dung chuyển khoản VietQR. Chỉ [A-Z0-9] để ngân hàng không cắt ký tự khi đối soát.';

COMMIT;

-- =====================================================================
-- KẾT THÚC V002
-- =====================================================================
