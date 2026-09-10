-- =====================================================================
--  NINOTEK F&B POS — Quyền cho tiến trình nhận dữ liệu đồng bộ
--  Migration : V003__sync_ingest_role.sql
--  Phụ thuộc : V002__sync_cdc_triggers.sql
-- =====================================================================
--
--  VẤN ĐỀ MIGRATION NÀY GIẢI QUYẾT
--
--  Cloud có trigger riêng: `fn_touch_row` tự tăng row_version, và
--  `fn_recalc_order_totals` tự tính lại tổng tiền. Khi NinoCloud nhận dữ
--  liệu đồng bộ từ máy POS, các trigger này chạy và làm row_version trên
--  Cloud nhảy lệch khỏi row_version của POS.
--
--  Hậu quả: guard optimistic locking đem so sánh hai bộ đếm khác nhau, từ
--  chối nhầm các bản cập nhật hợp lệ với lý do "Cloud đã có bản mới hơn".
--  Đơn hàng lên Cloud rồi đứng yên mãi ở trạng thái PENDING — chủ quán mở
--  NinoDash thấy doanh thu thiếu mà không hiểu vì sao.
--
--  Về ngữ nghĩa: máy POS là NGUỒN SỰ THẬT cho dữ liệu của chính nó. Cloud
--  là bản sao phục vụ báo cáo, phải ghi đúng những gì POS gửi lên.
--
--  Vì vậy tiến trình nhận sync chạy với `session_replication_role = replica`
--  để tắt trigger trong phạm vi transaction. Migration này cấp quyền đó.
-- =====================================================================

BEGIN;

DO $$
DECLARE
    app_role TEXT := current_setting('ninotek.app_role', TRUE);
BEGIN
    -- Cho phép chỉ định role qua: psql -v ninotek.app_role=ten_role
    IF app_role IS NULL OR app_role = '' THEN
        app_role := 'ninotek';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        RAISE NOTICE 'Chưa có role %, bỏ qua bước cấp quyền. '
                     'Tạo role rồi chạy lại migration này.', app_role;
        RETURN;
    END IF;

    -- PostgreSQL 15 trở lên: cấp quyền đổi tham số mà không cần superuser.
    IF current_setting('server_version_num')::INT >= 150000 THEN
        EXECUTE format(
            'GRANT SET ON PARAMETER session_replication_role TO %I', app_role);
        RAISE NOTICE 'Đã cấp quyền SET session_replication_role cho role %', app_role;
    ELSE
        RAISE NOTICE
            'PostgreSQL % chưa hỗ trợ GRANT SET ON PARAMETER (cần 15+). '
            'Role % phải là superuser, hoặc chấp nhận chạy không có guard '
            'optimistic locking khi đồng bộ (thứ tự vẫn được FIFO đảm bảo).',
            current_setting('server_version'), app_role;
    END IF;
END $$;

COMMIT;

-- =====================================================================
-- KẾT THÚC V003
-- =====================================================================
