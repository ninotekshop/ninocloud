// =====================================================================
//  NINOTEK CLOUD — Tiếp nhận dữ liệu đồng bộ từ máy POS
// =====================================================================
//  Windows Service trên máy POS đọc `sync_queue` theo FIFO tuyệt đối
//  (ORDER BY id ASC) và đẩy từng lô tối đa 100 bản ghi lên đây.
//
//  BA RÀNG BUỘC KHÔNG ĐƯỢC PHÁ:
//
//  1. IDEMPOTENT. Mạng ở quán chập chờn nên POS gửi lại là chuyện thường
//     ngày, không phải ngoại lệ. Cùng (entityId, sourceRowVersion) gửi mười
//     lần phải cho cùng kết quả như gửi một lần.
//
//  2. GIỮ ĐÚNG THỨ TỰ. Xử lý `orders UPDATE` trước `orders INSERT` sẽ tạo ra
//     đơn hàng mồ côi. Vì vậy duyệt tuần tự theo queueId, KHÔNG song song hoá.
//
//  3. DỪNG Ở LỖI ĐẦU TIÊN. Nếu bản ghi thứ 30 hỏng, 70 bản còn lại phụ thuộc
//     vào nó cũng vô nghĩa. Trả về `lastSyncedQueueId` để POS biết chính xác
//     cần gửi lại từ đâu.
//
//  Xung đột (CONFLICT) khác với lỗi (FAILED): CONFLICT nghĩa là Cloud đã có
//  phiên bản mới hơn — bỏ qua bản ghi đó và đi tiếp, không dừng cả lô.
// =====================================================================

import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../../common/database/database.service';
import type { SyncBatchDto, SyncQueueItemDto } from './dto/sync-batch.dto';

export type ItemStatus = 'SYNCED' | 'CONFLICT' | 'FAILED';

export interface SyncItemResult {
  queueId: number;
  status: ItemStatus;
  message?: string;
}

export interface SyncBatchResult {
  results: SyncItemResult[];
  lastSyncedQueueId: number | null;
}

/**
 * Danh sách trắng các bảng được phép đồng bộ.
 *
 * `entityType` đi thẳng vào câu lệnh SQL nên PHẢI kiểm tra qua danh sách này.
 * Máy POS là thiết bị đặt tại quán của khách hàng — không thể coi dữ liệu nó
 * gửi lên là đáng tin. Một `entityType` không được lọc là lỗ SQL injection.
 */
const SYNCABLE_TABLES: Record<string, readonly string[]> = {
  orders: [
    'id', 'store_id', 'order_code', 'table_id', 'shift_id', 'user_id',
    'cashier_id', 'device_id', 'order_type', 'status', 'guest_count',
    'customer_name', 'customer_phone', 'subtotal', 'discount_amount',
    'discount_reason', 'service_fee', 'vat_amount', 'final_total',
    'paid_amount', 'note', 'cancel_reason', 'cancelled_by_user_id',
    'created_at', 'completed_at', 'updated_at', 'row_version',
  ],
  order_details: [
    'id', 'order_id', 'item_id', 'item_name_snapshot', 'quantity', 'price',
    'topping_total', 'discount_amount', 'note', 'kitchen_status',
    'printed_at', 'served_at', 'cancelled_by_user_id', 'cancel_reason',
    'created_at', 'updated_at', 'row_version',
  ],
  order_detail_toppings: [
    'id', 'order_detail_id', 'topping_id', 'topping_name_snapshot',
    'extra_price', 'quantity', 'created_at',
  ],
  payments: [
    'id', 'store_id', 'order_id', 'shift_id', 'payment_method', 'status',
    'amount', 'received_amount', 'change_amount', 'transaction_ref',
    'gateway', 'paid_at', 'created_by_user_id', 'created_at', 'updated_at',
    'row_version',
  ],
  payment_qr_sessions: [
    'id', 'store_id', 'order_id', 'payment_id', 'account_no', 'account_name',
    'acq_id', 'amount', 'add_info', 'qr_code_raw', 'status', 'expires_at',
    'confirmed_at', 'created_at', 'updated_at', 'row_version',
  ],
  stock_transactions: [
    'id', 'store_id', 'ingredient_id', 'txn_type', 'quantity_change',
    'quantity_after', 'unit_cost', 'order_id', 'user_id', 'note', 'created_at',
  ],
  audit_logs: [
    'id', 'store_id', 'user_id', 'shift_id', 'action', 'entity_type',
    'entity_id', 'old_value', 'new_value', 'ip_address', 'device_id',
    'created_at',
  ],
  shifts: [
    'id', 'store_id', 'opened_by_user_id', 'closed_by_user_id', 'status',
    'opening_cash', 'closing_cash_counted', 'closing_cash_expected',
    'total_revenue', 'total_orders', 'opened_at', 'closed_at', 'note',
    'created_at', 'updated_at', 'row_version',
  ],
  tables: [
    'id', 'store_id', 'area_id', 'name', 'seat_capacity', 'status',
    'current_order_id', 'pos_x', 'pos_y', 'sort_order', 'updated_at',
    'row_version',
  ],
};

/**
 * Cột GENERATED trong PostgreSQL — KHÔNG được ghi trực tiếp.
 * Máy POS gửi lên vì SQLite cũng có chúng, nhưng ghi vào sẽ lỗi
 * "cannot insert into generated column".
 */
const GENERATED_COLUMNS = new Set(['line_total', 'cash_difference']);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly db: DatabaseService) {}

  async ingestBatch(dto: SyncBatchDto): Promise<SyncBatchResult> {
    // Sắp xếp lại phòng khi client gửi sai thứ tự. FIFO là bất biến của hệ
    // thống, không phải thứ ta tin client giữ đúng.
    const items = [...dto.items].sort((a, b) => a.queueId - b.queueId);

    const results: SyncItemResult[] = [];
    let lastSyncedQueueId: number | null = null;

    for (const item of items) {
      let result: SyncItemResult;
      try {
        result = await this.db.transaction(async (client) => {
          await this.suppressLocalTriggers(client);
          return this.applyItem(client, dto.storeId, item);
        });
      } catch (error) {
        result = {
          queueId: item.queueId,
          status: 'FAILED',
          message: (error as Error).message,
        };
      }

      results.push(result);

      if (result.status === 'FAILED') {
        // Dừng lại: các bản ghi sau có thể phụ thuộc vào bản ghi này.
        this.logger.error(
          `Lô sync dừng tại queueId=${item.queueId} (${item.entityType}): ${result.message}`,
        );
        break;
      }
      // CONFLICT vẫn tính là đã xử lý — Cloud có bản mới hơn, POS không cần gửi lại.
      lastSyncedQueueId = item.queueId;
    }

    const synced = results.filter((r) => r.status === 'SYNCED').length;
    const conflicts = results.filter((r) => r.status === 'CONFLICT').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;
    this.logger.log(
      `Lô sync cửa hàng ${dto.storeId}: ${synced} thành công, ` +
        `${conflicts} xung đột, ${failed} lỗi / ${items.length} bản ghi`,
    );

    return { results, lastSyncedQueueId };
  }

  /** Đã cảnh báo về việc thiếu quyền tắt trigger hay chưa (chỉ log một lần). */
  private triggerSuppressionWarned = false;

  /**
   * Tắt trigger nội bộ của Cloud trong phạm vi transaction đang chạy.
   *
   * VÌ SAO BẮT BUỘC:
   *   Cloud có trigger riêng — `fn_touch_row` tự tăng `row_version`, và
   *   `fn_recalc_order_totals` tự tính lại tổng tiền khi order_details đổi.
   *   Khi nhận dữ liệu đồng bộ, các trigger này chạy và làm `row_version` trên
   *   Cloud NHẢY LỆCH khỏi `row_version` của máy POS. Hai bộ đếm khác nhau,
   *   nhưng guard optimistic locking lại đem so sánh chúng với nhau — kết quả
   *   là bản cập nhật hợp lệ bị từ chối nhầm với lý do "Cloud đã có bản mới hơn",
   *   và đơn hàng đứng yên mãi ở trạng thái lúc mới tạo.
   *
   *   Về mặt ngữ nghĩa, máy POS là NGUỒN SỰ THẬT cho dữ liệu của chính nó.
   *   Cloud chỉ là bản sao để báo cáo. Nó phải ghi đúng những gì POS gửi lên,
   *   không được tự tính lại rồi ghi đè.
   *
   * Nếu tài khoản DB không đủ quyền, hệ thống vẫn chạy được: chỉ mất guard
   * optimistic locking, mà thứ tự vẫn được FIFO đảm bảo. Ghi cảnh báo một lần
   * để quản trị viên biết cần cấp quyền.
   */
  private async suppressLocalTriggers(client: PoolClient): Promise<void> {
    try {
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
    } catch (error) {
      if (!this.triggerSuppressionWarned) {
        this.triggerSuppressionWarned = true;
        this.logger.warn(
          `Không tắt được trigger nội bộ khi nhận sync: ${(error as Error).message}. ` +
            `Cấp quyền bằng: GRANT SET ON PARAMETER session_replication_role TO <app_user>; ` +
            `(xem migration V003). Hệ thống vẫn chạy nhưng mất lớp bảo vệ ` +
            `optimistic locking khi đồng bộ.`,
        );
      }
    }
  }

  private async applyItem(
    client: PoolClient,
    storeId: string,
    item: SyncQueueItemDto,
  ): Promise<SyncItemResult> {
    const allowedColumns = SYNCABLE_TABLES[item.entityType];
    if (!allowedColumns) {
      return {
        queueId: item.queueId,
        status: 'FAILED',
        message: `entityType không được phép đồng bộ: ${item.entityType}`,
      };
    }

    if (item.operation === 'DELETE') {
      await client.query(
        `DELETE FROM ${item.entityType} WHERE id = $1`,
        [item.entityId],
      );
      return { queueId: item.queueId, status: 'SYNCED' };
    }

    // Chỉ giữ lại các cột nằm trong danh sách trắng và không phải cột GENERATED.
    const payload = item.payload ?? {};
    const columns = Object.keys(payload).filter(
      (c) => allowedColumns.includes(c) && !GENERATED_COLUMNS.has(c),
    );

    if (columns.length === 0) {
      return {
        queueId: item.queueId,
        status: 'FAILED',
        message: 'Payload không chứa cột hợp lệ nào',
      };
    }
    if (!columns.includes('id')) {
      columns.unshift('id');
      (payload as Record<string, unknown>).id = item.entityId;
    }

    const values = columns.map((c) => (payload as Record<string, unknown>)[c]);
    const hasRowVersion = columns.includes('row_version');

    try {
      // INSERT và UPDATE phải dùng hai câu lệnh KHÁC NHAU.
      //
      // Không thể dùng chung `INSERT ... ON CONFLICT DO UPDATE` cho cả hai:
      // trigger CDC ở máy POS chỉ gửi các cột ĐÃ THAY ĐỔI trong payload UPDATE
      // (xem trg_sync_orders_upd trong V002 của SQLite). PostgreSQL kiểm tra
      // ràng buộc NOT NULL khi dựng dòng để INSERT — TRƯỚC khi tới được mệnh đề
      // ON CONFLICT. Nên một payload UPDATE thiếu `user_id` sẽ luôn ném
      // "null value in column user_id violates not-null constraint", kể cả khi
      // dòng đó đã tồn tại và lẽ ra chỉ cần UPDATE.
      //
      // Lỗi này làm HỎNG MỌI lần đồng bộ cập nhật — đơn hàng lên Cloud rồi
      // đứng yên mãi ở trạng thái lúc tạo, không bao giờ chuyển sang COMPLETED.
      const result =
        item.operation === 'UPDATE'
          ? await this.applyUpdate(client, item, columns, values, hasRowVersion)
          : await this.applyInsert(client, item, columns, values, hasRowVersion);

      if (result.rowCount === 0) {
        if (item.operation === 'UPDATE' && !(await this.rowExists(client, item))) {
          // Bản ghi cha chưa từng tới Cloud — lô INSERT trước đó bị mất.
          // Báo FAILED để POS gửi lại từ đầu, thay vì âm thầm nuốt mất dữ liệu.
          return {
            queueId: item.queueId,
            status: 'FAILED',
            message:
              `Nhận UPDATE cho ${item.entityType}/${item.entityId} nhưng bản ghi ` +
              `chưa tồn tại trên Cloud — bản INSERT trước đó đã thất lạc. ` +
              `Máy POS cần gửi lại từ bản ghi INSERT.`,
          };
        }
        return {
          queueId: item.queueId,
          status: 'CONFLICT',
          message: hasRowVersion
            ? 'Cloud đã có phiên bản bằng hoặc mới hơn — bỏ qua'
            : 'Bản ghi đã tồn tại — bỏ qua (idempotent)',
        };
      }
      return { queueId: item.queueId, status: 'SYNCED' };
    } catch (error) {
      const message = (error as Error).message;
      // Khoá ngoại chưa có: bản ghi cha chưa được sync. POS gửi sai thứ tự
      // hoặc lô trước bị lỗi. Báo FAILED để POS gửi lại từ đúng vị trí.
      if (message.includes('violates foreign key constraint')) {
        return {
          queueId: item.queueId,
          status: 'FAILED',
          message: `Thiếu bản ghi cha — kiểm tra thứ tự FIFO. Chi tiết: ${message}`,
        };
      }
      throw error;
    }
  }

  /**
   * INSERT bản ghi mới.
   *
   * `ON CONFLICT (id) DO UPDATE ... WHERE row_version <` là trái tim của
   * idempotency + optimistic locking gộp làm một:
   *   • Gửi trùng (cùng row_version)  → WHERE sai  → 0 dòng → CONFLICT
   *   • Cloud đã có bản mới hơn       → WHERE sai  → 0 dòng → CONFLICT
   *   • Bản ghi thực sự mới hơn       → WHERE đúng → ghi đè → SYNCED
   */
  private applyInsert(
    client: PoolClient,
    item: SyncQueueItemDto,
    columns: string[],
    values: unknown[],
    hasRowVersion: boolean,
  ) {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const setClause = columns
      .filter((c) => c !== 'id')
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    if (!hasRowVersion || !setClause) {
      return client.query(
        `INSERT INTO ${item.entityType} (${columns.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        values,
      );
    }

    return client.query(
      `INSERT INTO ${item.entityType} (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE
          SET ${setClause}
        WHERE ${item.entityType}.row_version < EXCLUDED.row_version
       RETURNING id`,
      values,
    );
  }

  /**
   * UPDATE bản ghi đã có — chỉ chạm vào các cột máy POS thực sự gửi lên.
   *
   * Điều kiện `row_version < $n` giữ nguyên ngữ nghĩa Optimistic Locking:
   * bản ghi cũ hơn đến muộn (do mạng đảo thứ tự gói tin) sẽ không ghi đè
   * bản mới hơn đã có trên Cloud.
   */
  private applyUpdate(
    client: PoolClient,
    item: SyncQueueItemDto,
    columns: string[],
    values: unknown[],
    hasRowVersion: boolean,
  ) {
    const updatable = columns.filter((c) => c !== 'id');
    if (updatable.length === 0) {
      return Promise.resolve({ rowCount: 0, rows: [] } as never);
    }

    const setClause = updatable
      .map((c, i) => `${c} = $${i + 1}`)
      .join(', ');
    const params = updatable.map(
      (c) => values[columns.indexOf(c)],
    );
    params.push(item.entityId);

    const guard = hasRowVersion
      ? ` AND row_version < $${params.length + 1}`
      : '';
    if (hasRowVersion) {
      params.push(values[columns.indexOf('row_version')]);
    }

    return client.query(
      `UPDATE ${item.entityType}
          SET ${setClause}
        WHERE id = $${updatable.length + 1}${guard}
       RETURNING id`,
      params,
    );
  }

  private async rowExists(
    client: PoolClient,
    item: SyncQueueItemDto,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM ${item.entityType} WHERE id = $1`,
      [item.entityId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
