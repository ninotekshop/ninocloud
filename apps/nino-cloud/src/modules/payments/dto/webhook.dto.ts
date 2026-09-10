import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload IPN từ cổng thanh toán (SePay / Casso / ngân hàng).
 *
 * Các trường được khai LỎNG có chủ ý: mỗi cổng gửi một hình dạng khác nhau và
 * ta không kiểm soát được. Thà nhận và ghi log còn hơn từ chối rồi bị retry
 * vô hạn. Việc siết chặt nằm ở guard HMAC, không phải ở đây.
 */
export class VietQrWebhookDto {
  @IsString() @MaxLength(50)
  gateway!: string;

  @IsString() @MaxLength(100)
  transactionId!: string;

  @IsNumber()
  amount!: number;

  /** Nội dung chuyển khoản THÔ — ngân hàng có chèn thêm chữ. */
  @IsString() @MaxLength(500)
  content!: string;

  @IsOptional() @IsString() @MaxLength(100)
  orderCode?: string;

  @IsOptional() @IsString() @MaxLength(30)
  bankAccount?: string;

  @IsIn(['SUCCESS', 'FAILED'])
  status!: 'SUCCESS' | 'FAILED';

  @IsOptional() @IsString()
  timestamp?: string;
}
