/**
 * =====================================================================
 *  NINOTEK CLOUD — Kiểm thử end-to-end luồng thanh toán và đồng bộ
 * =====================================================================
 *  Chạy với PostgreSQL THẬT, không mock. Mọi kịch bản dưới đây đều đã
 *  được chạy tay bằng curl trước khi viết thành test.
 *
 *  Yêu cầu:
 *    docker compose -f docker-compose.dev.yml up -d
 *    npm run test:e2e
 * =====================================================================
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/database/database.service';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { decodeVietQrPayload } from '../src/modules/payments/vietqr.builder';

const STORE_ID = '22222222-2222-4222-8222-222222222222';
const WAITER_ID = '33333333-3333-4333-8333-000000000003';
const CASHIER_ID = '33333333-3333-4333-8333-000000000002';
const ITEM_CAFE_SUA = '77777777-7777-4777-8777-000000000002';

const HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret';

function sign(body: unknown): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

describe('Thanh toán VietQR (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let cashierToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ProblemDetailsFilter(false));
    await app.init();

    db = app.get(DatabaseService);
    cashierToken = app.get(JwtService).sign({
      sub: CASHIER_ID,
      storeId: STORE_ID,
      username: 'cashier',
      role: 'CASHIER',
      tokenType: 'access',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Tạo một đơn hàng thật trong DB để test. */
  async function createOrder(amountItems = 2): Promise<{ id: string; code: string; total: number }> {
    const id = randomUUID();
    const [{ code }] = await db.query<{ code: string }>(
      'SELECT fn_next_order_code($1) AS code',
      [STORE_ID],
    );
    await db.execute(
      `INSERT INTO orders (id, store_id, order_code, user_id, cashier_id,
                           order_type, guest_count, subtotal, final_total)
       VALUES ($1, $2, $3, $4, $5, 'TAKE_AWAY', 1, 0, 0)`,
      [id, STORE_ID, code, WAITER_ID, CASHIER_ID],
    );
    await db.execute(
      `INSERT INTO order_details (id, order_id, item_id, item_name_snapshot,
                                  quantity, price, topping_total)
       VALUES (gen_random_uuid(), $1, $2, 'Ca phe sua da', $3, 22000, 10000)`,
      [id, ITEM_CAFE_SUA, amountItems],
    );
    const order = await db.queryOne<{ final_total: string }>(
      'SELECT final_total FROM orders WHERE id = $1',
      [id],
    );
    return { id, code, total: Number(order!.final_total) };
  }

  // ------------------------------------------------------------------
  describe('POST /payments/vietqr/generate', () => {
    it('sinh chuỗi EMVCo hợp lệ, giải mã ngược ra đúng dữ liệu gốc', async () => {
      const order = await createOrder(2);

      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/generate')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ orderId: order.id })
        .expect(200);

      expect(res.body.qrCode).toBeDefined();
      expect(res.body.qrDataURL).toMatch(/^data:image\/png;base64,/);
      expect(res.body.websocketUrl).toBe(`/ws/payments?order_id=${order.code}`);

      const decoded = decodeVietQrPayload(res.body.qrCode);
      expect(decoded.crcValid).toBe(true);
      expect(decoded.acqId).toBe('970436');
      expect(decoded.amount).toBe(order.total);
      // addInfo PHẢI bằng order_code — đây là khoá đối soát duy nhất
      expect(decoded.addInfo).toBe(order.code);
    });

    it('lấy số tiền từ DATABASE, không tin số client gửi lên', async () => {
      const order = await createOrder(3); // 3 x 32.000 = 96.000

      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/generate')
        .set('Authorization', `Bearer ${cashierToken}`)
        // Client cố tình khai số tiền nhỏ hơn
        .send({ orderId: order.id, expectedAmount: 1000 })
        .expect(200);

      expect(decodeVietQrPayload(res.body.qrCode).amount).toBe(order.total);
      expect(order.total).toBe(96000);
    });

    it('từ chối đơn đã thanh toán xong', async () => {
      const order = await createOrder(1);
      await db.execute(
        `UPDATE orders SET status='COMPLETED', completed_at=NOW() WHERE id=$1`,
        [order.id],
      );

      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/generate')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ orderId: order.id })
        .expect(422);
    });

    it('trả 404 khi không có đơn', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/generate')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ orderId: randomUUID() })
        .expect(404);
    });
  });

  // ------------------------------------------------------------------
  describe('POST /payments/vietqr/webhook — bảo mật', () => {
    const body = {
      gateway: 'SePay',
      transactionId: 'TEST_NO_SIG',
      amount: 99000,
      content: 'NINOPOS100001',
      status: 'SUCCESS' as const,
    };

    it('từ chối webhook không có chữ ký', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .send(body)
        .expect(401);
    });

    it('từ chối chữ ký sai', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', '0'.repeat(64))
        .send(body)
        .expect(401);
    });

    it('từ chối khi body bị sửa sau khi ký', async () => {
      const signature = sign(body);
      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', signature)
        .send({ ...body, amount: 1 }) // đổi số tiền, giữ chữ ký cũ
        .expect(401);
    });

    it('từ chối webhook có timestamp quá cũ (chống phát lại)', async () => {
      const stale = {
        ...body,
        transactionId: 'TEST_STALE',
        timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      };
      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', sign(stale))
        .send(stale)
        .expect(401);
    });
  });

  // ------------------------------------------------------------------
  describe('POST /payments/vietqr/webhook — nghiệp vụ', () => {
    it('chốt đơn, trừ kho và giải phóng bàn khi nhận đủ tiền', async () => {
      const order = await createOrder(2);
      const before = await db.queryOne<{ stock_quantity: string }>(
        `SELECT stock_quantity FROM ingredients WHERE name = 'Hat ca phe Robusta'`,
      );

      const payload = {
        gateway: 'SePay',
        transactionId: `TEST_${randomUUID()}`,
        amount: order.total,
        // Ngân hàng CHÈN THÊM chữ — phải dò được mã đơn bằng regex
        content: `MBVCB.9876543210.${order.code}.CT tu 0123456789`,
        status: 'SUCCESS' as const,
        timestamp: new Date().toISOString(),
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', sign(payload))
        .send(payload)
        .expect(200);

      expect(res.body.matchedOrderCode).toBe(order.code);

      const after = await db.queryOne<{ status: string; paid_amount: string }>(
        'SELECT status, paid_amount FROM orders WHERE id = $1',
        [order.id],
      );
      expect(after!.status).toBe('COMPLETED');
      expect(Number(after!.paid_amount)).toBe(order.total);

      // Trigger DB đã trừ kho theo định lượng: 2 ly x 0.02 kg = 0.04 kg
      const stockAfter = await db.queryOne<{ stock_quantity: string }>(
        `SELECT stock_quantity FROM ingredients WHERE name = 'Hat ca phe Robusta'`,
      );
      expect(
        Number(before!.stock_quantity) - Number(stockAfter!.stock_quantity),
      ).toBeCloseTo(0.04, 4);
    });

    it('idempotent: gửi lại ba lần chỉ tạo một bản ghi thanh toán', async () => {
      const order = await createOrder(1);
      const payload = {
        gateway: 'SePay',
        transactionId: `TEST_${randomUUID()}`,
        amount: order.total,
        content: `${order.code} thanh toan`,
        status: 'SUCCESS' as const,
        timestamp: new Date().toISOString(),
      };
      const signature = sign(payload);

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/cloud/payments/vietqr/webhook')
          .set('X-Signature', signature)
          .send(payload)
          .expect(200);
      }

      const payments = await db.query(
        'SELECT id FROM payments WHERE order_id = $1',
        [order.id],
      );
      expect(payments).toHaveLength(1);

      const after = await db.queryOne<{ paid_amount: string }>(
        'SELECT paid_amount FROM orders WHERE id = $1',
        [order.id],
      );
      // Cộng dồn ba lần sẽ ra gấp ba — đây là thứ test này canh gác
      expect(Number(after!.paid_amount)).toBe(order.total);
    });

    it('báo động khi cùng mã giao dịch được dùng cho đơn khác', async () => {
      const first = await createOrder(1);
      const second = await createOrder(1);
      const txnId = `TEST_${randomUUID()}`;

      const a = {
        gateway: 'SePay', transactionId: txnId, amount: first.total,
        content: first.code, status: 'SUCCESS' as const,
        timestamp: new Date().toISOString(),
      };
      await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', sign(a)).send(a).expect(200);

      const b = { ...a, amount: second.total, content: second.code };
      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', sign(b)).send(b).expect(200);

      // Phải nói rõ đơn nào đã dùng mã đó, không được nuốt lặng
      expect(res.body.reason).toContain(first.code);
      expect(res.body.reason).toContain('đối soát thủ công');

      const secondAfter = await db.queryOne<{ status: string }>(
        'SELECT status FROM orders WHERE id = $1', [second.id],
      );
      expect(secondAfter!.status).toBe('PENDING');
    });

    it('không dò được mã đơn thì vẫn trả 200 để cổng không retry vô hạn', async () => {
      const payload = {
        gateway: 'SePay',
        transactionId: `TEST_${randomUUID()}`,
        amount: 50000,
        content: 'CK khong co ma don hang',
        status: 'SUCCESS' as const,
        timestamp: new Date().toISOString(),
      };
      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/payments/vietqr/webhook')
        .set('X-Signature', sign(payload))
        .send(payload)
        .expect(200);

      expect(res.body.matchedOrderCode).toBeNull();
      expect(res.body.received).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  describe('POST /sync/transactions', () => {
    function orderItem(id: string, code: string, queueId: number) {
      const now = new Date().toISOString();
      return {
        queueId, entityType: 'orders', entityId: id, operation: 'INSERT' as const,
        sourceRowVersion: 1,
        payload: {
          id, store_id: STORE_ID, order_code: code, user_id: WAITER_ID,
          order_type: 'DINE_IN', status: 'PENDING', guest_count: 2,
          subtotal: 38000, final_total: 38000, paid_amount: 0,
          created_at: now, updated_at: now, row_version: 1,
        },
      };
    }

    it('nhận payload UPDATE chỉ chứa các cột đã thay đổi', async () => {
      // Trigger CDC ở máy POS chỉ gửi cột thay đổi. Nếu server dùng
      // INSERT...ON CONFLICT cho UPDATE, PostgreSQL sẽ báo lỗi NOT NULL
      // trước khi tới ON CONFLICT — làm hỏng MỌI lần đồng bộ cập nhật.
      const id = randomUUID();
      const code = `E2E${Date.now()}`;
      const now = new Date().toISOString();

      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/sync/transactions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          storeId: STORE_ID,
          items: [
            orderItem(id, code, 1),
            {
              queueId: 2, entityType: 'orders', entityId: id,
              operation: 'UPDATE' as const, sourceRowVersion: 2,
              payload: { id, status: 'COMPLETED', paid_amount: 38000,
                         completed_at: now, updated_at: now, row_version: 2 },
            },
          ],
        })
        .expect(200);

      expect(res.body.results.map((r: { status: string }) => r.status))
        .toEqual(['SYNCED', 'SYNCED']);

      const order = await db.queryOne<{ status: string; row_version: number }>(
        'SELECT status, row_version FROM orders WHERE id = $1', [id],
      );
      expect(order!.status).toBe('COMPLETED');
      // row_version phải giữ đúng giá trị POS gửi, không bị trigger Cloud đẩy lên
      expect(order!.row_version).toBe(2);
    });

    it('idempotent: gửi lại cùng lô trả về CONFLICT, không nhân đôi dữ liệu', async () => {
      const id = randomUUID();
      const code = `E2E${Date.now()}B`;
      const batch = { storeId: STORE_ID, items: [orderItem(id, code, 1)] };

      await request(app.getHttpServer())
        .post('/api/v1/cloud/sync/transactions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send(batch).expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/sync/transactions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send(batch).expect(200);

      expect(res.body.results[0].status).toBe('CONFLICT');

      const rows = await db.query('SELECT id FROM orders WHERE order_code = $1', [code]);
      expect(rows).toHaveLength(1);
    });

    it('báo FAILED khi nhận UPDATE cho bản ghi chưa từng tới Cloud', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/sync/transactions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          storeId: STORE_ID,
          items: [{
            queueId: 1, entityType: 'orders', entityId: randomUUID(),
            operation: 'UPDATE' as const, sourceRowVersion: 2,
            payload: { status: 'SERVING', updated_at: new Date().toISOString(), row_version: 2 },
          }],
        })
        .expect(200);

      expect(res.body.results[0].status).toBe('FAILED');
      expect(res.body.results[0].message).toContain('thất lạc');
      expect(res.body.lastSyncedQueueId).toBeNull();
    });

    it('chặn entityType không nằm trong danh sách trắng (chống SQL injection)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/sync/transactions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          storeId: STORE_ID,
          items: [{
            queueId: 1, entityType: 'users; DROP TABLE orders--',
            entityId: randomUUID(), operation: 'INSERT' as const,
            payload: { id: randomUUID() },
          }],
        })
        .expect(200);

      expect(res.body.results[0].status).toBe('FAILED');
      expect(res.body.results[0].message).toContain('không được phép');

      // Bảng orders phải còn nguyên
      const rows = await db.query('SELECT 1 FROM orders LIMIT 1');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('dừng ở bản ghi lỗi đầu tiên và báo đúng vị trí cần gửi lại', async () => {
      const good = randomUUID();
      const res = await request(app.getHttpServer())
        .post('/api/v1/cloud/sync/transactions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          storeId: STORE_ID,
          items: [
            orderItem(good, `E2E${Date.now()}C`, 10),
            { queueId: 11, entityType: 'khong_ton_tai', entityId: randomUUID(),
              operation: 'INSERT' as const, payload: { id: randomUUID() } },
            orderItem(randomUUID(), `E2E${Date.now()}D`, 12),
          ],
        })
        .expect(200);

      // Bản ghi thứ ba KHÔNG được xử lý — nó có thể phụ thuộc bản ghi lỗi
      expect(res.body.results).toHaveLength(2);
      expect(res.body.lastSyncedQueueId).toBe(10);
    });
  });
});
