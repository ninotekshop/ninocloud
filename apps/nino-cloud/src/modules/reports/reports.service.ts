import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import type { AccessTokenPayload } from '../auth/auth.types';
import type { DashboardQueryDto } from './dto/dashboard-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  async dashboard(query: DashboardQueryDto, user: AccessTokenPayload) {
    if (query.storeId !== user.storeId) {
      throw new ForbiddenException('Không được truy cập dữ liệu cửa hàng khác');
    }

    const totals = await this.db.queryOne<{
      net_revenue: string;
      gross_revenue: string;
      total_discount: string;
      total_orders: string;
      total_guests: string;
    }>(
      `SELECT COALESCE(SUM(final_total), 0) AS net_revenue,
              COALESCE(SUM(subtotal + discount_amount), 0) AS gross_revenue,
              COALESCE(SUM(discount_amount), 0) AS total_discount,
              COUNT(*)::text AS total_orders,
              COALESCE(SUM(guest_count), 0)::text AS total_guests
         FROM orders
        WHERE store_id = $1 AND status = 'COMPLETED'
          AND completed_at >= $2::date
          AND completed_at < ($3::date + INTERVAL '1 day')`,
      [query.storeId, query.from, query.to],
    );

    const hourly = await this.db.query<{ hour: number; revenue: string; order_count: string }>(
      `SELECT EXTRACT(HOUR FROM completed_at)::int AS hour,
              COALESCE(SUM(final_total), 0) AS revenue,
              COUNT(*)::text AS order_count
         FROM orders
        WHERE store_id = $1 AND status = 'COMPLETED'
          AND completed_at >= $2::date
          AND completed_at < ($3::date + INTERVAL '1 day')
        GROUP BY 1 ORDER BY 1`,
      [query.storeId, query.from, query.to],
    );

    const topItems = await this.db.query<{
      item_id: string; item_name: string; quantity: string; revenue: string;
    }>(
      `SELECT d.item_id, d.item_name_snapshot AS item_name,
              SUM(d.quantity) AS quantity, SUM(d.line_total) AS revenue
         FROM order_details d
         JOIN orders o ON o.id = d.order_id
        WHERE o.store_id = $1 AND o.status = 'COMPLETED'
          AND o.completed_at >= $2::date
          AND o.completed_at < ($3::date + INTERVAL '1 day')
        GROUP BY d.item_id, d.item_name_snapshot
        ORDER BY revenue DESC LIMIT 10`,
      [query.storeId, query.from, query.to],
    );

    const payments = await this.db.query<{ method: string; amount: string; count: string }>(
      `SELECT payment_method AS method, SUM(amount) AS amount, COUNT(*)::text AS count
         FROM payments
        WHERE store_id = $1 AND status = 'SUCCESS'
          AND paid_at >= $2::date
          AND paid_at < ($3::date + INTERVAL '1 day')
        GROUP BY payment_method ORDER BY amount DESC`,
      [query.storeId, query.from, query.to],
    );

    const lowStock = await this.db.query<{
      ingredient_id: string; name: string; stock_quantity: string; min_stock_alert: string; unit: string;
    }>(
      `SELECT id AS ingredient_id, name, stock_quantity, min_stock_alert, unit
         FROM ingredients WHERE store_id = $1 AND stock_quantity <= min_stock_alert
        ORDER BY stock_quantity ASC`,
      [query.storeId],
    );

    const netRevenue = Number(totals?.net_revenue ?? 0);
    const totalOrders = Number(totals?.total_orders ?? 0);
    return {
      netRevenue,
      grossRevenue: Number(totals?.gross_revenue ?? 0),
      totalDiscount: Number(totals?.total_discount ?? 0),
      totalOrders,
      totalGuests: Number(totals?.total_guests ?? 0),
      avgOrderValue: totalOrders === 0 ? 0 : netRevenue / totalOrders,
      revenueChangePercent: 0,
      tableOccupancyPercent: 0,
      revenueByHour: hourly.map((row) => ({ hour: row.hour, revenue: Number(row.revenue), orderCount: Number(row.order_count) })),
      topSellingItems: topItems.map((row) => ({ itemId: row.item_id, itemName: row.item_name, quantity: Number(row.quantity), revenue: Number(row.revenue) })),
      paymentBreakdown: payments.map((row) => ({ method: row.method, amount: Number(row.amount), count: Number(row.count) })),
      lowStockAlerts: lowStock.map((row) => ({ ingredientId: row.ingredient_id, name: row.name, stockQuantity: Number(row.stock_quantity), minStockAlert: Number(row.min_stock_alert), unit: row.unit })),
      suspiciousActivities: [],
    };
  }

  async activeTables(query: { storeId: string }, user: AccessTokenPayload) {
    if (query.storeId !== user.storeId) {
      throw new ForbiddenException('Không được truy cập dữ liệu cửa hàng khác');
    }

    const rows = await this.db.query<{
      table_id: string;
      table_name: string;
      zone_name: string;
      status: string;
      guest_count: number;
      running_total: string;
      opened_at: Date;
    }>(
      `SELECT t.id AS table_id,
              t.name AS table_name,
              COALESCE(z.name, 'Tầng 1') AS zone_name,
              t.status,
              COALESCE(o.guest_count, 0) AS guest_count,
              COALESCE(o.subtotal, 0) AS running_total,
              o.created_at AS opened_at
         FROM tables t
    LEFT JOIN zones z ON z.id = t.zone_id
    LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'OPEN'
        WHERE t.store_id = $1
        ORDER BY t.name ASC`,
      [query.storeId],
    );

    return rows.map((r) => ({
      tableId: r.table_id,
      tableName: r.table_name,
      zoneName: r.zone_name,
      status: r.status,
      guestCount: Number(r.guest_count),
      runningTotal: Number(r.running_total),
      openedAt: r.opened_at,
    }));
  }
}
