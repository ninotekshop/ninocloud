import {
  IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min,
} from 'class-validator';

export class GenerateVietQrDto {
  @IsUUID('4', { message: 'orderId phải là UUID v4' })
  orderId!: string;

  /** Bỏ trống ⇒ lấy từ cấu hình ngân hàng của cửa hàng. */
  @IsOptional()
  @Matches(/^\d{6}$/, {
    message: 'acqId phải là 6 chữ số (mã BIN NAPAS), xem napas-bank-bins.json',
  })
  acqId?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,19}$/, {
    message: 'accountNo phải gồm 1-19 ký tự chữ hoặc số',
  })
  accountNo?: string;

  @IsOptional() @IsString() @MaxLength(150)
  accountName?: string;

  /**
   * Chỉ dùng để đối chiếu — số tiền thực tế LUÔN lấy từ database.
   * Nếu lệch, server từ chối để chặn client cố thu thiếu tiền.
   */
  @IsOptional() @IsInt() @Min(1)
  expectedAmount?: number;
}
