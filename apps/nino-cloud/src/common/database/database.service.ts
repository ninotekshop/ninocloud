// =====================================================================
//  NINOTEK CLOUD — Tầng truy cập PostgreSQL
// =====================================================================
//  Dùng `pg` trực tiếp thay vì ORM.
//
//  Vì sao không dùng Prisma/TypeORM?
//    `database/postgres/migrations/*.sql` là NGUỒN SỰ THẬT DUY NHẤT cho schema
//    (xem ADR-005 và database/README.md). Một ORM sẽ tạo ra bản mô tả schema
//    thứ hai phải giữ đồng bộ bằng tay — đúng thứ mà nguyên tắc "một nguồn sự
//    thật" tồn tại để ngăn. Schema này còn phải mirror sang SQLite cho máy POS,
//    nên hai bản mô tả sẽ thành ba.
//
//  Đánh đổi: mất type-safety tự động của ORM. Bù lại bằng interface khai báo
//  tay trong từng repository, và tất cả đều được test bằng DB thật.
// =====================================================================

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const schema = this.config.get<string>('database.schema', 'nino');

    this.pool = new Pool({
      connectionString: this.config.getOrThrow<string>('database.url'),
      max: this.config.get<number>('database.poolMax', 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Đặt search_path cho MỌI kết nối mới trong pool. Nếu chỉ đặt một lần lúc
      // khởi động, các kết nối được pool tạo thêm về sau sẽ không thấy schema
      // `nino` và mọi truy vấn sẽ lỗi "relation does not exist" — một cách
      // ngẫu nhiên, chỉ khi tải cao.
      options: `-c search_path=${schema},public`,
    });

    this.pool.on('error', (err) => {
      // Kết nối rỗi bị server đóng (restart, timeout). pg tự thay thế; chỉ log.
      this.logger.error(`Lỗi kết nối rỗi trong pool: ${err.message}`);
    });

    const { rows } = await this.pool.query<{ now: Date; schema: string }>(
      'SELECT NOW() as now, current_schema() as schema',
    );
    this.logger.log(
      `Đã kết nối PostgreSQL — schema=${rows[0].schema}, giờ máy chủ=${rows[0].now.toISOString()}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.logger.log('Đã đóng pool kết nối PostgreSQL');
  }

  /** Truy vấn đơn lẻ, tự lấy và trả kết nối về pool. */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params as unknown[]);
    return result.rows;
  }

  /** Truy vấn trả về đúng một dòng, hoặc null. */
  async queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /** Số dòng bị ảnh hưởng — dùng để phát hiện xung đột Optimistic Locking. */
  async execute(sql: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.pool.query(sql, params as unknown[]);
    return result.rowCount ?? 0;
  }

  /**
   * Chạy một khối lệnh trong transaction. Tự COMMIT khi thành công,
   * tự ROLLBACK khi có lỗi, và LUÔN trả kết nối về pool.
   *
   * Mọi thao tác ghi nhiều bảng (chốt đơn, nhận sync batch) BẮT BUỘC đi qua
   * đây — nếu không, một lỗi giữa chừng sẽ để lại dữ liệu nửa vời: đơn hàng
   * đã COMPLETED nhưng kho chưa trừ.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          `ROLLBACK thất bại: ${(rollbackError as Error).message}`,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Dùng cho endpoint health check. */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
