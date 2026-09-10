// =====================================================================
//  NINOTEK CLOUD — Nghiệp vụ thanh toán VietQR
// =====================================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';

import { DatabaseService } from '../../common/database/database.service';
import { PaymentsGateway } from '../realtime/payments.gateway';
import {
  buildVietQrPayload,
  extractOrderCode,
  VietQrError,
} from './vietqr.builder';
import type { GenerateVietQrDto } from './dto/generate-vietqr.dto';
import type { VietQrWebhookDto } from './dto/webhook.dto';

interface OrderRow {
  id: string;
  store_id: string;
  order_code: string;
  final_total: string;
  paid_amount: string;
  status: string;
  row_version: number;
}

interface StoreRow {
  id: string;
  bank_acq_id: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
}

export interface GenerateResult {
  qrSessionId: string;
  qrCode: string;
  qrDataURL: string;
  expiresAt: string;
  websocketUrl: string;
}

export interface WebhookResult {
  received: boolean;
  matchedOrderCode: string | null;
  reason?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly gateway: PaymentsGateway,
  ) {}

  // ------------------------------------------------------------------
  // Sinh mã VietQR động
  // ------------------------------------------------------------------

  async generateVietQr(dto: GenerateVietQrDto): Promise<GenerateResult> {
    const order = await this.db.queryOne<OrderRow>(
      `SELECT id, store_id, order_code, final_total, paid_amount, status, row_version
         FROM orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [dto.orderId],
    );
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng ${dto.orderId}`);
    }
    if (order.status === 'COMPLETED') {
      throw new UnprocessableEntityException(
        `Đơn ${order.order_code} đã thanh toán xong — không sinh QR mới`,
      );
    }
    if (order.status === 'CANCELLED') {
      throw new UnprocessableEntityException(
        `Đơn ${order.order_code} đã bị huỷ`,
      );
    }

    const store = await this.db.queryOne<StoreRow>(
      `SELECT id, bank_acq_id, bank_account_no, bank_account_name
         FROM stores WHERE id = $1`,
      [order.store_id],
    );

    // Ưu tiên tham số truyền vào, sau đó mới lấy cấu hình của cửa hàng.
    const acqId = dto.acqId ?? store?.bank_acq_id ?? '';
    const accountNo = dto.accountNo ?? store?.bank_account_no ?? '';
    const accountName = dto.accountName ?? store?.bank_account_name ?? '';

    if (!acqId || !accountNo) {
      throw new UnprocessableEntityException(
        'Cửa hàng chưa cấu hình tài khoản ngân hàng nhận tiền. ' +
          'Vào Cài đặt → Thanh toán để nhập số tài khoản và chọn ngân hàng.',
      );
    }

    // Số tiền LUÔN lấy từ database, không lấy từ request. Client gửi số tiền
    // nhỏ hơn thực tế sẽ tạo ra mã QR thu thiếu tiền mà vẫn khớp đối soát.
    const amountDue = Math.round(
      Number(order.final_total) - Number(order.paid_amount),
    );
    if (amountDue <= 0) {
      throw new UnprocessableEntityException(
        `Đơn ${order.order_code} không còn số tiền phải trả`,
      );
    }

    let qrCode: string;
    try {
      qrCode = buildVietQrPayload({
        acqId,
        accountNo,
        amount: amountDue,
        // addInfo LUÔN là order_code lấy từ DB — đây là khoá đối soát duy nhất
        // khi webhook ngân hàng báo về.
        addInfo: order.order_code,
      });
    } catch (error) {
      if (error instanceof VietQrError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }

    const qrDataURL = await QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });

    const ttlMinutes = this.config.get<number>(
      'vietqr.sessionTtlMinutes',
      15,
    );
    const sessionId = randomUUID();

    await this.db.execute(
      `INSERT INTO payment_qr_sessions
         (id, store_id, order_id, account_no, account_name, acq_id,
          amount, add_info, qr_code_raw, qr_data_url, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING',
               NOW() + ($11 || ' minutes')::interval)`,
      [
        sessionId,
        order.store_id,
        order.id,
        accountNo,
        accountName,
        acqId,
        amountDue,
        order.order_code,
        qrCode,
        qrDataURL,
        String(ttlMinutes),
      ],
    );

    this.logger.log(
      `Đã sinh VietQR cho ${order.order_code}: ${amountDue.toLocaleString('vi-VN')}đ ` +
        `qua BIN ${acqId}`,
    );

    return {
      qrSessionId: sessionId,
      qrCode,
      qrDataURL,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      websocketUrl: `/ws/payments?order_id=${order.order_code}`,
    };
  }

  // ------------------------------------------------------------------
  // Xử lý webhook ngân hàng
  // ------------------------------------------------------------------

  /**
   * Luôn trả 200 — kể cả khi không khớp đơn nào.
   *
   * Cổng thanh toán retry cho tới khi nhận được 200. Trả lỗi cho một webhook
   * mà ta không xử lý được sẽ khiến nó bị gửi lại vô hạn. Thay vào đó ghi
   * nguyên văn vào `payment_webhook_logs` để đối soát thủ công sau.
   */
  async handleWebhook(
    dto: VietQrWebhookDto,
    rawPayload: unknown,
    signatureValid: boolean,
  ): Promise<WebhookResult> {
    // Ngân hàng CHÈN THÊM chữ vào nội dung chuyển khoản, ví dụ
    // "MBVCB.9876543210.NINOPOS100234.CT tu 0123456789".
    // Phải dò bằng regex; so sánh === sẽ trượt hết.
    const orderCode =
      extractOrderCode(dto.content ?? '') ??
      (dto.orderCode ? extractOrderCode(dto.orderCode) : null);

    const logId = await this.writeWebhookLog(
      dto,
      rawPayload,
      signatureValid,
      orderCode,
    );

    if (dto.status !== 'SUCCESS') {
      await this.markLogProcessed(logId, `Bỏ qua: trạng thái ${dto.status}`);
      return {
        received: true,
        matchedOrderCode: orderCode,
        reason: `Trạng thái ${dto.status}, không ghi nhận thanh toán`,
      };
    }

    if (!orderCode) {
      this.logger.warn(
        `Webhook ${dto.transactionId} không dò được mã đơn trong nội dung: ` +
          `"${dto.content}"`,
      );
      await this.markLogProcessed(
        logId,
        'Không dò được mã đơn hàng trong nội dung chuyển khoản',
      );
      return {
        received: true,
        matchedOrderCode: null,
        reason: 'Không khớp đơn hàng nào — cần đối soát thủ công',
      };
    }

    const outcome = await this.applyPayment(dto, orderCode);
    await this.markLogProcessed(logId, outcome.reason);

    if (outcome.paymentApplied) {
      // Bắn WebSocket để NinoPOS tự chốt bill, mở két và in hoá đơn.
      this.gateway.emitPaymentSuccess(orderCode, {
        orderId: outcome.orderId,
        orderCode,
        paymentMethod: 'VIETQR',
        amountPaid: dto.amount,
        transactionRef: dto.transactionId,
        gateway: dto.gateway,
        paidAt: dto.timestamp ?? new Date().toISOString(),
        message: 'Thanh toán VietQR thành công',
      });
    }

    return {
      received: true,
      matchedOrderCode: orderCode,
      reason: outcome.reason,
    };
  }

  /**
   * Ghi nhận thanh toán trong một transaction.
   *
   * Idempotency dựa trên UNIQUE INDEX (gateway, transaction_ref) ở tầng DB.
   * Không dùng "SELECT rồi INSERT nếu chưa có" — hai webhook đến cùng lúc sẽ
   * cùng thấy "chưa có" và cùng ghi. Ràng buộc UNIQUE là thứ duy nhất chặn
   * được ở mức tin cậy.
   */
  private async applyPayment(
    dto: VietQrWebhookDto,
    orderCode: string,
  ): Promise<{ paymentApplied: boolean; orderId: string | null; reason: string }> {
    return this.db.transaction(async (client) => {
      const orderResult = await client.query<OrderRow>(
        `SELECT id, store_id, order_code, final_total, paid_amount, status, row_version
           FROM orders
          WHERE order_code = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [orderCode],
      );
      const order = orderResult.rows[0];

      if (!order) {
        return {
          paymentApplied: false,
          orderId: null,
          reason: `Không tìm thấy đơn hàng ${orderCode}`,
        };
      }

      // Chèn bản ghi thanh toán. ON CONFLICT DO NOTHING dựa vào
      // uq_payments_gateway_txnref — webhook gửi lại sẽ không ghi trùng.
      const inserted = await client.query(
        `INSERT INTO payments
           (id, store_id, order_id, payment_method, status, amount,
            transaction_ref, gateway, paid_at)
         VALUES (gen_random_uuid(), $1, $2, 'VIETQR', 'SUCCESS', $3, $4, $5, $6)
         ON CONFLICT (gateway, transaction_ref)
           WHERE transaction_ref IS NOT NULL
           DO NOTHING
         RETURNING id`,
        [
          order.store_id,
          order.id,
          dto.amount,
          dto.transactionId,
          dto.gateway,
          dto.timestamp ?? new Date().toISOString(),
        ],
      );

      if (inserted.rowCount === 0) {
        // Ràng buộc UNIQUE (gateway, transaction_ref) là TOÀN CỤC, không theo
        // từng đơn. Cần phân biệt hai tình huống rất khác nhau:
        //
        //   a) Cùng giao dịch, cùng đơn  → webhook gửi lại. Bỏ qua, đúng ý đồ.
        //   b) Cùng giao dịch, KHÁC đơn  → BẤT THƯỜNG. Hoặc ngân hàng cấp trùng
        //      mã, hoặc ta đối soát nhầm đơn. Tiền đã vào tài khoản nhưng đơn
        //      này sẽ không bao giờ được chốt. Phải báo động, không được nuốt
        //      lặng — đây là tiền thật của khách.
        const existing = await client.query<{ order_id: string; order_code: string }>(
          `SELECT p.order_id, o.order_code
             FROM payments p
             JOIN orders o ON o.id = p.order_id
            WHERE p.gateway = $1 AND p.transaction_ref = $2`,
          [dto.gateway, dto.transactionId],
        );
        const previous = existing.rows[0];

        if (previous && previous.order_id !== order.id) {
          this.logger.error(
            `ĐỐI SOÁT BẤT THƯỜNG: giao dịch ${dto.gateway}/${dto.transactionId} ` +
              `đã được ghi cho đơn ${previous.order_code}, nay lại báo về cho đơn ` +
              `${orderCode}. Đơn ${orderCode} KHÔNG được chốt. Cần kiểm tra thủ công.`,
          );
          return {
            paymentApplied: false,
            orderId: order.id,
            reason:
              `Mã giao dịch đã dùng cho đơn ${previous.order_code} — ` +
              `đơn ${orderCode} chưa được chốt, cần đối soát thủ công`,
          };
        }

        this.logger.log(
          `Webhook ${dto.transactionId} đã xử lý trước đó — bỏ qua (idempotent)`,
        );
        return {
          paymentApplied: false,
          orderId: order.id,
          reason: 'Giao dịch đã được ghi nhận trước đó',
        };
      }

      // Cộng dồn số tiền đã trả, chốt đơn nếu đã đủ.
      // Trigger DB sẽ tự trừ kho và giải phóng bàn khi status = COMPLETED.
      const paidBefore = Number(order.paid_amount);
      const finalTotal = Number(order.final_total);
      const paidAfter = paidBefore + Number(dto.amount);
      const fullyPaid = paidAfter >= finalTotal;

      await client.query(
        `UPDATE orders
            SET paid_amount  = $2,
                status       = CASE WHEN $3 THEN 'COMPLETED'::order_status_enum ELSE status END,
                completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END
          WHERE id = $1`,
        [order.id, paidAfter, fullyPaid],
      );

      const reason = fullyPaid
        ? `Đã chốt đơn ${orderCode}, thu ${Number(dto.amount).toLocaleString('vi-VN')}đ`
        : `Thu một phần ${Number(dto.amount).toLocaleString('vi-VN')}đ, ` +
          `còn thiếu ${(finalTotal - paidAfter).toLocaleString('vi-VN')}đ`;

      this.logger.log(reason);
      return { paymentApplied: true, orderId: order.id, reason };
    });
  }

  private async writeWebhookLog(
    dto: VietQrWebhookDto,
    rawPayload: unknown,
    signatureValid: boolean,
    orderCode: string | null,
  ): Promise<number> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO payment_webhook_logs
         (gateway, transaction_id, order_code, amount, raw_payload,
          is_signature_valid, is_processed)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id`,
      [
        dto.gateway,
        dto.transactionId,
        orderCode,
        dto.amount,
        JSON.stringify(rawPayload),
        signatureValid,
      ],
    );
    return Number(row?.id ?? 0);
  }

  private async markLogProcessed(
    logId: number,
    message: string,
  ): Promise<void> {
    if (!logId) return;
    await this.db.execute(
      `UPDATE payment_webhook_logs
          SET is_processed = TRUE, error_message = $2
        WHERE id = $1`,
      [logId, message],
    );
  }
}
