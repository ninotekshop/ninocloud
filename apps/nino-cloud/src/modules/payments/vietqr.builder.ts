/**
 * =====================================================================
 *  NINOTEK F&B POS — VietQR EMVCo Builder (TypeScript / NestJS)
 * =====================================================================
 *  Bản port 1-1 của tools/vietqr-reference/vietqr_reference.py
 *
 *  ⚠️ KHÔNG sửa file này mà không chạy lại test:
 *     npm run test -- vietqr.builder.spec.ts
 *  Test đối chiếu trực tiếp với golden vectors tại
 *     packages/api-contracts/data/vietqr-test-vectors.json
 * =====================================================================
 */

export const GUID_NAPAS = 'A000000727';
export const CURRENCY_VND = '704';
export const COUNTRY_VN = 'VN';

/** Chuyển tới TÀI KHOẢN — dùng cho F&B */
export const SERVICE_TO_ACCOUNT = 'QRIBFTTA';
/** Chuyển tới SỐ THẺ */
export const SERVICE_TO_CARD = 'QRIBFTTC';

export const INIT_STATIC = '11';
export const INIT_DYNAMIC = '12';

/**
 * Tag 62 (Additional Data) tối đa 99 ký tự theo EMVCo. Tag 08 bên trong tốn
 * thêm 4 ký tự header, nên nội dung chuyển khoản chỉ được tối đa 95.
 * Cắt ở 99 rồi mới bọc TLV sẽ tạo trường 62 dài 103 và bị ngân hàng từ chối.
 */
export const MAX_PURPOSE_LENGTH = 95;

/**
 * Nhiều ngân hàng cắt nội dung chuyển khoản quanh mốc 50 ký tự khi bắn
 * webhook. Mã hoá đơn phải nằm ở ĐẦU chuỗi để không bị cắt mất.
 */
export const RECOMMENDED_PURPOSE_LENGTH = 50;

export class VietQrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VietQrError';
  }
}

export interface VietQrRequest {
  /** Mã BIN ngân hàng theo NAPAS, đúng 6 chữ số. VD: '970436' = Vietcombank */
  acqId: string;
  /** Số tài khoản nhận tiền, 1-19 ký tự chữ/số */
  accountNo: string;
  /** Số tiền VND (số nguyên). Bỏ trống ⇒ sinh QR tĩnh */
  amount?: number | null;
  /** Nội dung chuyển khoản — luôn dùng `orders.order_code` */
  addInfo?: string;
  /** Tên merchant, tag 59 (tuỳ chọn, tối đa 25 ký tự) */
  accountName?: string;
  /** Thành phố, tag 60 (tuỳ chọn, tối đa 15 ký tự) */
  merchantCity?: string;
  serviceCode?: string;
}

/**
 * CRC-16/CCITT-FALSE: poly=0x1021, init=0xFFFF, refIn/refOut=false, xorOut=0x0000.
 *
 * ⚠️ KHÔNG phải CRC-16/XMODEM (init=0x0000). Dùng sai biến thể là lỗi tích hợp
 * VietQR phổ biến nhất — QR vẫn quét được nhưng app ngân hàng báo "mã không hợp lệ".
 * Kiểm chứng: crc16CcittFalse('123456789') === 0x29B1
 */
export function crc16CcittFalse(data: string): number {
  let crc = 0xffff;
  const bytes = Buffer.from(data, 'utf8');
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** Đóng gói một trường TLV: 2 ký tự tag + 2 chữ số độ dài + giá trị. */
export function tlv(tag: string, value: string): string {
  if (value.length > 99) {
    throw new VietQrError(
      `Trường ${tag} dài ${value.length} ký tự, vượt giới hạn 99 của EMVCo`,
    );
  }
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

/** Bỏ dấu tiếng Việt và chuyển hoa. */
export function stripVietnamese(text: string): string {
  return text
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toUpperCase();
}

/** Chuẩn hoá nội dung chuyển khoản: bỏ dấu, chỉ giữ [A-Z0-9 ], gộp khoảng trắng, cắt độ dài. */
export function sanitizeAddInfo(text: string, maxLen = MAX_PURPOSE_LENGTH): string {
  return stripVietnamese(text)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, maxLen);
}

function validate(req: VietQrRequest): void {
  if (!/^\d{6}$/.test(req.acqId ?? '')) {
    throw new VietQrError(
      `acqId phải là 6 chữ số (mã BIN NAPAS), nhận được: ${JSON.stringify(req.acqId)}`,
    );
  }
  if (!/^[A-Za-z0-9]{1,19}$/.test(req.accountNo ?? '')) {
    throw new VietQrError(
      `accountNo phải gồm 1-19 ký tự chữ/số, nhận được: ${JSON.stringify(req.accountNo)}`,
    );
  }
  if (req.amount !== undefined && req.amount !== null) {
    if (!Number.isInteger(req.amount)) {
      throw new VietQrError('amount phải là số nguyên VND (không dùng số thập phân)');
    }
    if (req.amount <= 0) {
      throw new VietQrError(`amount phải lớn hơn 0, nhận được: ${req.amount}`);
    }
    if (req.amount > 9_999_999_999) {
      throw new VietQrError(`amount vượt trần 9.999.999.999đ: ${req.amount}`);
    }
  }
  const svc = req.serviceCode ?? SERVICE_TO_ACCOUNT;
  if (svc !== SERVICE_TO_ACCOUNT && svc !== SERVICE_TO_CARD) {
    throw new VietQrError(`serviceCode không hợp lệ: ${JSON.stringify(svc)}`);
  }
}

/** Dựng chuỗi VietQR EMVCo hoàn chỉnh, đã kèm CRC. */
export function buildVietQrPayload(req: VietQrRequest): string {
  validate(req);

  const beneficiary = tlv('00', req.acqId) + tlv('01', req.accountNo);
  const merchantAccount =
    tlv('00', GUID_NAPAS) +
    tlv('01', beneficiary) +
    tlv('02', req.serviceCode ?? SERVICE_TO_ACCOUNT);

  const isDynamic = req.amount !== undefined && req.amount !== null;

  const parts: string[] = [
    tlv('00', '01'),
    tlv('01', isDynamic ? INIT_DYNAMIC : INIT_STATIC),
    tlv('38', merchantAccount),
    tlv('53', CURRENCY_VND),
  ];
  if (isDynamic) parts.push(tlv('54', String(req.amount)));
  parts.push(tlv('58', COUNTRY_VN));

  if (req.accountName) parts.push(tlv('59', sanitizeAddInfo(req.accountName, 25)));
  if (req.merchantCity) parts.push(tlv('60', sanitizeAddInfo(req.merchantCity, 15)));

  if (req.addInfo) {
    const info = sanitizeAddInfo(req.addInfo);
    if (info) parts.push(tlv('62', tlv('08', info)));
  }

  const body = parts.join('') + '6304';
  return body + crc16CcittFalse(body).toString(16).toUpperCase().padStart(4, '0');
}

// --- Giải mã (dùng cho kiểm thử và đối soát webhook) ---------------------

export function parseTlv(payload: string): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) {
      throw new VietQrError(`Chuỗi TLV cụt tại vị trí ${i}`);
    }
    const tag = payload.slice(i, i + 2);
    const rawLen = payload.slice(i + 2, i + 4);
    const len = Number(rawLen);
    if (!/^\d{2}$/.test(rawLen)) {
      throw new VietQrError(`Độ dài không phải số tại vị trí ${i + 2}: ${rawLen}`);
    }
    const start = i + 4;
    const end = start + len;
    if (end > payload.length) {
      throw new VietQrError(
        `Trường ${tag} khai độ dài ${len} nhưng chuỗi chỉ còn ${payload.length - start} ký tự`,
      );
    }
    result[tag] = payload.slice(start, end);
    i = end;
  }
  return result;
}

export interface VietQrDecoded {
  acqId: string;
  accountNo: string;
  serviceCode: string;
  amount: number | null;
  addInfo: string;
  merchantName: string;
  isDynamic: boolean;
  crcValid: boolean;
}

export function decodeVietQrPayload(payload: string): VietQrDecoded {
  if (payload.length < 8) {
    throw new VietQrError('Chuỗi quá ngắn để là một mã VietQR hợp lệ');
  }
  const marker = payload.lastIndexOf('6304');
  if (marker === -1 || marker + 8 !== payload.length) {
    throw new VietQrError('Không tìm thấy trường CRC (6304) ở cuối chuỗi');
  }
  const body = payload.slice(0, marker + 4);
  const givenCrc = payload.slice(marker + 4).toUpperCase();
  const crcValid =
    givenCrc === crc16CcittFalse(body).toString(16).toUpperCase().padStart(4, '0');

  const tags = parseTlv(payload);
  const out: VietQrDecoded = {
    acqId: '',
    accountNo: '',
    serviceCode: '',
    amount: tags['54'] !== undefined ? Number(tags['54']) : null,
    addInfo: '',
    merchantName: tags['59'] ?? '',
    isDynamic: tags['01'] === INIT_DYNAMIC,
    crcValid,
  };

  if (tags['38']) {
    const mai = parseTlv(tags['38']);
    out.serviceCode = mai['02'] ?? '';
    if (mai['01']) {
      const ben = parseTlv(mai['01']);
      out.acqId = ben['00'] ?? '';
      out.accountNo = ben['01'] ?? '';
    }
  }
  if (tags['62']) {
    out.addInfo = parseTlv(tags['62'])['08'] ?? '';
  }
  return out;
}

/**
 * Rút mã hoá đơn ra khỏi nội dung chuyển khoản thực tế của ngân hàng.
 *
 * Ngân hàng CHÈN THÊM chữ vào nội dung, ví dụ:
 *   'NINOPOS100234 CHUYEN KHOAN'
 *   'MBVCB.9876543210.NINOPOS100234.CT tu 0123456789'
 * ⚠️ Webhook KHÔNG được so sánh bằng `===` mà phải dò theo regex này.
 */
export function extractOrderCode(
  transferContent: string,
  prefix = 'NINOPOS',
): string | null {
  const m = stripVietnamese(transferContent ?? '').match(
    new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+`),
  );
  return m ? m[0] : null;
}
