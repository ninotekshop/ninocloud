// =====================================================================
//  NINOTEK CLOUD — Guard xác thực chữ ký webhook ngân hàng
// =====================================================================
//  Đây là lớp phòng thủ DUY NHẤT của endpoint webhook.
//
//  Endpoint `/payments/vietqr/webhook` phải public trên Internet để cổng
//  thanh toán gọi vào. Không có guard này, bất kỳ ai biết URL đều có thể
//  POST một JSON "status: SUCCESS" và ăn hàng miễn phí — không cần tài khoản,
//  không cần token, không để lại dấu vết nào ngoài log.
//
//  BA ĐIỀU BẮT BUỘC, thiếu một là thủng:
//
//  1. So sánh chữ ký bằng `timingSafeEqual`, KHÔNG dùng `===`.
//     So sánh chuỗi thông thường thoát ra ngay ở byte đầu khác nhau. Kẻ tấn
//     công đo thời gian phản hồi có thể dò ra chữ ký đúng từng byte một.
//
//  2. Ký trên RAW BODY, không phải object đã parse.
//     `JSON.stringify(req.body)` KHÔNG tái lập được byte gốc — thứ tự khoá,
//     khoảng trắng, cách escape unicode đều có thể khác. Chữ ký sẽ trượt
//     ngẫu nhiên. Vì vậy `main.ts` bật `rawBody: true`.
//
//  3. Kiểm tra timestamp để chặn replay.
//     Không có bước này, kẻ tấn công chỉ cần chụp lại MỘT webhook hợp lệ rồi
//     phát lại mãi mãi — chữ ký vẫn đúng vì nội dung không đổi.
// =====================================================================

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/** Request của Express có thêm rawBody khi bật `rawBody: true` lúc tạo app. */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class WebhookHmacGuard implements CanActivate {
  private readonly logger = new Logger(WebhookHmacGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();

    const secret = this.config.getOrThrow<string>('webhook.hmacSecret');
    const provided = this.readSignatureHeader(request);
    const rawBody = request.rawBody;

    if (!rawBody || rawBody.length === 0) {
      throw new UnauthorizedException(
        'Webhook không có body — không thể xác thực chữ ký',
      );
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    if (!this.safeCompare(provided, expected)) {
      // Không tiết lộ chữ ký mong đợi trong log. Chỉ ghi đủ để điều tra.
      this.logger.warn(
        `Từ chối webhook: chữ ký HMAC không khớp (IP ${request.ip}, ` +
          `độ dài body ${rawBody.length} byte)`,
      );
      throw new UnauthorizedException('Chữ ký webhook không hợp lệ');
    }

    this.assertFresh(request);
    return true;
  }

  private readSignatureHeader(request: Request): string {
    // Mỗi cổng thanh toán dùng một tên header khác nhau.
    const raw =
      request.headers['x-signature'] ??
      request.headers['x-hub-signature-256'] ??
      request.headers['x-sepay-signature'] ??
      '';

    const value = Array.isArray(raw) ? (raw[0] ?? '') : String(raw);

    if (!value) {
      throw new UnauthorizedException('Webhook thiếu header chữ ký');
    }

    // Một số cổng gửi kèm tiền tố thuật toán: "sha256=abc123..."
    return value.startsWith('sha256=') ? value.slice(7) : value;
  }

  /**
   * So sánh chống tấn công đo thời gian.
   *
   * `timingSafeEqual` NÉM LỖI nếu hai buffer khác độ dài — nên phải kiểm tra
   * độ dài trước. Bản thân việc lộ độ dài không nguy hiểm: chữ ký HMAC-SHA256
   * luôn dài đúng 64 ký tự hex, kẻ tấn công đã biết trước.
   */
  private safeCompare(provided: string, expected: string): boolean {
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(
        Buffer.from(provided, 'utf8'),
        Buffer.from(expected, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Chặn replay attack: từ chối webhook có timestamp lệch quá xa hiện tại.
   *
   * Bỏ qua nếu cổng thanh toán không gửi timestamp — không phải cổng nào cũng
   * có. Khi đó lớp bảo vệ còn lại là idempotency theo `transaction_id`, vốn
   * cũng chặn được replay ở tầng nghiệp vụ.
   */
  private assertFresh(request: RawBodyRequest): void {
    const header = request.headers['x-timestamp'];
    const bodyTimestamp = (request.body as { timestamp?: string } | undefined)
      ?.timestamp;
    const raw = Array.isArray(header) ? header[0] : (header ?? bodyTimestamp);
    if (!raw) return;

    const sentAt = new Date(raw);
    if (Number.isNaN(sentAt.getTime())) return;

    const maxSkew = this.config.get<number>('webhook.maxSkewSeconds', 300);
    const skewSeconds = Math.abs(Date.now() - sentAt.getTime()) / 1000;

    if (skewSeconds > maxSkew) {
      this.logger.warn(
        `Từ chối webhook: timestamp lệch ${Math.round(skewSeconds)}s ` +
          `(giới hạn ${maxSkew}s) — nghi vấn phát lại`,
      );
      throw new UnauthorizedException(
        'Timestamp của webhook nằm ngoài khoảng cho phép',
      );
    }
  }
}
