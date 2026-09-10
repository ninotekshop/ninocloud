// =====================================================================
//  NINOTEK CLOUD — Cấu hình ứng dụng
//  Mọi giá trị bí mật đọc từ biến môi trường, không hard-code.
// =====================================================================

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  database: {
    url: process.env.DATABASE_URL,
    schema: process.env.DATABASE_SCHEMA ?? 'nino',
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },

  webhook: {
    hmacSecret: process.env.WEBHOOK_HMAC_SECRET,
    maxSkewSeconds: parseInt(process.env.WEBHOOK_MAX_SKEW_SECONDS ?? '300', 10),
  },
  licensing: {
    revocationToken: process.env.LICENSE_REVOCATION_TOKEN,
    manifestPath: process.env.LICENSE_REVOCATION_PATH ?? 'data/revocations.json',
  },

  vietqr: {
    sessionTtlMinutes: parseInt(process.env.VIETQR_SESSION_TTL_MINUTES ?? '15', 10),
  },
});
