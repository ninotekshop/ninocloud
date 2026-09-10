/**
 * =====================================================================
 *  Kiểm thử VietQR đối chiếu golden vectors
 * =====================================================================
 *  Đọc THẲNG packages/api-contracts/data/vietqr-test-vectors.json —
 *  cùng bộ dữ liệu mà bản C# của NinoPOS phải pass.
 *
 *  Nếu TypeScript và C# sinh chuỗi khác nhau, một trong hai sẽ tạo mã QR
 *  bị ngân hàng từ chối. Test này chặn việc đó lọt lên production.
 * =====================================================================
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildVietQrPayload,
  decodeVietQrPayload,
  crc16CcittFalse,
  extractOrderCode,
  sanitizeAddInfo,
  parseTlv,
  VietQrError,
} from './vietqr.builder';

const VECTORS = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../../packages/api-contracts/data/vietqr-test-vectors.json'),
    'utf8',
  ),
);

describe('CRC-16/CCITT-FALSE', () => {
  it('cho ra giá trị kiểm chứng chuẩn 0x29B1', () => {
    // Nếu ra 0x31C3 thì đang dùng nhầm CRC-16/XMODEM (init = 0x0000)
    expect(crc16CcittFalse('123456789')).toBe(0x29b1);
  });

  it('khớp với giá trị ghi trong golden vectors', () => {
    expect(crc16CcittFalse('123456789').toString(16).toUpperCase().padStart(4, '0'))
      .toBe(VECTORS.crcAlgorithm.checkValueOf123456789);
  });
});

describe('buildVietQrPayload — golden vectors', () => {
  for (const v of VECTORS.vectors) {
    it(`${v.name}: ${v.note}`, () => {
      const payload = buildVietQrPayload({
        acqId: v.input.acqId,
        accountNo: v.input.accountNo,
        amount: v.input.amount,
        addInfo: v.input.addInfo,
      });
      expect(payload).toBe(v.expectedPayload);
      expect(payload).toHaveLength(v.expectedLength);

      const decoded = decodeVietQrPayload(payload);
      expect(decoded.crcValid).toBe(true);
      expect(decoded.acqId).toBe(v.input.acqId);
      expect(decoded.accountNo).toBe(v.input.accountNo);
      expect(decoded.amount).toBe(v.input.amount ?? null);
      expect(decoded.addInfo).toBe(v.expectedDecodedAddInfo);
    });
  }
});

describe('buildVietQrPayload — dữ liệu không hợp lệ', () => {
  for (const c of VECTORS.invalidInputs) {
    it(`chặn ${c.name}`, () => {
      expect(() =>
        buildVietQrPayload({
          acqId: c.input.acqId,
          accountNo: c.input.accountNo,
          amount: c.input.amount,
          addInfo: c.input.addInfo,
        }),
      ).toThrow(VietQrError);
    });
  }
});

describe('Giới hạn độ dài trường 62', () => {
  // Từng có lỗi: cắt addInfo ở 99 ký tự rồi mới bọc TLV → tag 62 dài 103,
  // vượt giới hạn EMVCo. Trần đúng là 95.
  it.each([0, 1, 50, 94, 95, 96, 200, 500])('addInfo %i ký tự → tag 62 <= 99', (len) => {
    const payload = buildVietQrPayload({
      acqId: '970436', accountNo: '0123456789', amount: 150000, addInfo: 'A'.repeat(len),
    });
    const tags = parseTlv(payload);
    if (tags['62']) expect(tags['62'].length).toBeLessThanOrEqual(99);
    expect(decodeVietQrPayload(payload).crcValid).toBe(true);
  });
});

describe('Ví dụ sai trong tài liệu gốc', () => {
  it('mã QR trong tài liệu hỏng tới mức không parse nổi', () => {
    // Không chỉ sai CRC — độ dài TLV khai sai (3857/0127 thay vì 3854/0124)
    // khiến bộ đọc trượt khỏi ranh giới trường ngay từ đầu chuỗi.
    // Đây chính xác là điều app ngân hàng gặp phải khi quét mã đó.
    const bad = VECTORS.knownBadExample;
    expect(() => decodeVietQrPayload(bad.payload)).toThrow(VietQrError);
  });

  it('chuỗi đúng cho cùng dữ liệu đầu vào', () => {
    const correct = buildVietQrPayload({
      acqId: '970436', accountNo: '0123456789', amount: 150000, addInfo: 'NINOPOS100234',
    });
    expect(correct).toBe(VECTORS.knownBadExample.correctPayload);
  });
});

describe('Chuẩn hoá tiếng Việt', () => {
  it.each([
    ['Thanh toán hoá đơn', 'THANH TOAN HOA DON'],
    ['Bàn 01 — ít đường', 'BAN 01 IT DUONG'],
    ['Đặng Đình Đức', 'DANG DINH DUC'],
    ['NINOPOS-100234/QN#01', 'NINOPOS 100234 QN 01'],
    ['   nhiều    khoảng   trắng   ', 'NHIEU KHOANG TRANG'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeAddInfo(input)).toBe(expected);
  });
});

describe('Đối soát nội dung chuyển khoản từ webhook', () => {
  for (const c of VECTORS.webhookContentParsing.cases) {
    it(`"${c.content}" → ${c.expected}`, () => {
      expect(extractOrderCode(c.content)).toBe(c.expected);
    });
  }

  it('phát hiện chuỗi bị sửa số tiền', () => {
    const payload = buildVietQrPayload({
      acqId: '970436', accountNo: '0123456789', amount: 150000, addInfo: 'NINOPOS100234',
    });
    const tampered = payload.replace('5406150000', '5406100000');
    expect(tampered).not.toBe(payload);
    expect(decodeVietQrPayload(tampered).crcValid).toBe(false);
  });
});
