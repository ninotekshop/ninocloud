const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const PUBLIC_KEY_PATH = path.join(__dirname, 'assets', 'ninotek_public.pem');
const SIGNATURE_BYTES = 64;

function getMachineId() {
  let machineGuid = '';
  if (process.platform === 'win32') {
    try {
      machineGuid = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true })
        .split(/\r?\n/).find((line) => /MachineGuid/i.test(line))?.split(/\s{2,}/).pop()?.trim() || '';
    } catch (_) {}
  }
  return crypto.createHash('sha256').update([machineGuid, os.hostname()].filter(Boolean).join('|') || os.hostname()).digest('hex').slice(0, 32).toUpperCase();
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let buffer = 0; const output = [];
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('License key sai định dạng.');
    buffer = (buffer << 5) | index; bits += 5;
    if (bits >= 8) { bits -= 8; output.push((buffer >> bits) & 0xff); }
  }
  return Buffer.from(output);
}

function verifyLicense(key, machineId = getMachineId()) {
  try {
    const formatted = String(key || '').trim().toUpperCase();
    if (!formatted.startsWith('NINO-')) throw new Error('License key phải bắt đầu bằng NINO-.');
    const blob = base32Decode(formatted.slice(5).replace(/-/g, ''));
    if (blob.length <= SIGNATURE_BYTES) throw new Error('License key thiếu dữ liệu.');
    const data = blob.subarray(0, -SIGNATURE_BYTES);
    const signature = blob.subarray(-SIGNATURE_BYTES);
    const payload = JSON.parse(data.toString('utf8'));
    const publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_PATH));
    if (!crypto.verify(null, data, publicKey, signature)) return { valid: false, reason: 'Chữ ký license không hợp lệ.' };
    if (payload.mid !== machineId) return { valid: false, reason: 'License được cấp cho máy khác.' };
    if (!payload.pkg || !payload.iss || !Number.isInteger(payload.dev) || payload.dev < 1) return { valid: false, reason: 'Thông tin license không hợp lệ.' };
    if (payload.exp) {
      const expiry = new Date(`${payload.exp}T23:59:59Z`);
      if (Number.isNaN(expiry.valueOf())) return { valid: false, reason: 'Ngày hết hạn license không hợp lệ.' };
      if (Date.now() > expiry.valueOf()) return { valid: false, reason: `License đã hết hạn ngày ${payload.exp}.` };
    }

    return { valid: true, reason: payload.exp ? `Gói ${payload.pkg} · hết hạn ${payload.exp}` : `Gói ${payload.pkg} · vĩnh viễn`, payload };
  } catch (error) {
    return { valid: false, reason: error.message };
  }

}

function fetchRevocationManifest(url, timeoutMs = 5000) {
  if (!url || !/^https:\/\//i.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { Accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) { response.resume(); resolve(null); return; }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function verifyRevocationManifest(manifest) {
  try {
    if (!manifest || typeof manifest !== 'object' || !manifest.payload || !manifest.signature) return null;
    const data = Buffer.from(JSON.stringify(manifest.payload));
    const signature = Buffer.from(manifest.signature, 'base64');
    const publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_PATH));
    if (!crypto.verify(null, data, publicKey, signature)) return null;
    return manifest.payload;
  } catch (_) {
    return null;
  }
}

function getTrialStatus(startedAt) {
  const start = startedAt ? new Date(startedAt) : new Date();
  const normalizedStart = Number.isNaN(start.valueOf()) ? new Date() : start;
  const expiresAt = new Date(normalizedStart);
  expiresAt.setDate(expiresAt.getDate() + 14);
  const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000));
  return {
    valid: Date.now() < expiresAt.getTime(),
    trial: true,
    trialStartedAt: normalizedStart.toISOString(),
    trialExpiresAt: expiresAt.toISOString(),
    daysRemaining,
    reason: Date.now() < expiresAt.getTime() ? `Bản Trial · còn ${daysRemaining} ngày` : 'Bản Trial đã hết hạn.',
  };
}

module.exports = { getMachineId, verifyLicense, getTrialStatus, fetchRevocationManifest, verifyRevocationManifest };
