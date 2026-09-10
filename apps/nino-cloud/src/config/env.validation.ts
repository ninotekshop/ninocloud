// =====================================================================
//  Kiểm tra biến môi trường NGAY LÚC KHỞI ĐỘNG
// =====================================================================
//  Thà chết lúc boot còn hơn chạy được rồi mới hỏng giữa giờ cao điểm.
//  Đặc biệt WEBHOOK_HMAC_SECRET: thiếu nó thì endpoint webhook trở thành
//  cánh cửa mở cho bất kỳ ai giả lệnh "đã thanh toán".
// =====================================================================

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_HMAC_SECRET'] as const;

const PLACEHOLDERS = [
  'thay-bang-chuoi-ngau-nhien-that-truoc-khi-len-production',
  'thay-bang-secret-that-tu-cong-thanh-toan',
  'changeme',
  'secret',
];

export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED.filter((k) => !config[k]);
  if (missing.length > 0) {
    throw new Error(
      `Thiếu biến môi trường bắt buộc: ${missing.join(', ')}\n` +
        `Chép .env.example thành .env và điền giá trị thật.`,
    );
  }

  // Chặn deploy production với giá trị mẫu còn nguyên trong .env.example
  if (config.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'WEBHOOK_HMAC_SECRET']) {
      const value = String(config[key]);
      if (PLACEHOLDERS.includes(value)) {
        throw new Error(
          `${key} vẫn đang là giá trị mẫu. Không được chạy production với secret mặc định.`,
        );
      }
      if (value.length < 32) {
        throw new Error(
          `${key} quá ngắn (${value.length} ký tự). Tối thiểu 32. ` +
            `Sinh bằng: openssl rand -base64 48`,
        );
      }
    }
  }

  return config;
}
