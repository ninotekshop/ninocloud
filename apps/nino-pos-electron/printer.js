const net = require('net');
const { execFile } = require('child_process');

const INIT = Buffer.from([0x1b, 0x40]);
const DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
const CUT = Buffer.from([0x1d, 0x56, 0x00]);

function stripVietnamese(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D').replace(/[^\x00-\x7F]/g, '');
}
function money(value) { return Number(value || 0).toLocaleString('vi-VN'); }
function line(text = '') { return Buffer.from(`${stripVietnamese(text)}\n`, 'ascii'); }
function twoColumns(left, right, width = 48) {
  const cleanLeft = stripVietnamese(left); const cleanRight = stripVietnamese(right);
  const spaces = Math.max(1, width - cleanLeft.length - cleanRight.length);
  return line(cleanLeft + ' '.repeat(spaces) + cleanRight);
}
const DEFAULT_BILL_TEMPLATE = [
  '{{store.name}}', '{{store.address}}', '{{store.phone}}', '{{separator}}',
  '{{title}}', 'HD: #{{order.id}}                 Ban: {{order.table}}',
  'Khach: {{order.customer}}', 'Ngay: {{order.date}}              Gio: {{order.time}}',
  '{{separator}}', 'Mon                         SL  T.Tien', '{{items}}', '{{separator}}',
  'Tong tien mon:              {{subtotal}}', 'VAT:                        {{vat}}',
  'THANH TOAN:                 {{total}}',
  '{{footer}}',
].join('\n');
function renderBillTemplate(order, settings, type, width) {
  const footer = settings['printer.bill.footer'] || 'Cam on quy khach!';
  const itemLines = (order.details || []).map((detail) => twoColumns(`${detail.product_name} x${detail.quantity}`, money(detail.amount), width).toString('ascii').trimEnd()).join('\n');
  const values = {
    '{{store.name}}': settings['store.name'] || 'NinoPOS', '{{store.address}}': settings['store.address'] || '',
    '{{store.phone}}': settings['store.phone'] || '', '{{separator}}': '='.repeat(width),
    '{{title}}': type === 'BILL' ? 'HOA DON THANH TOAN' : type === 'DRAFT' ? 'PHIEU TAM TINH' : type === 'BAR' ? 'PHIEU PHA CHE (BAR)' : 'PHIEU CHE BIEN (BEP)', '{{order.id}}': order.id || '',
    '{{order.table}}': order.table_name || 'Mang di', '{{order.customer}}': order.customer_name || 'Vang lai',
    '{{order.date}}': new Date().toLocaleDateString('vi-VN'), '{{order.time}}': new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    '{{items}}': itemLines, '{{subtotal}}': money(order.subtotal), '{{vat}}': money(order.vat_amount),
    '{{total}}': money(order.grand_total), '{{payment}}': order.payment_method ? order.payment_method.split(':')[0] : '',
    '{{footer}}': footer,
  };
  return (settings['printer.bill.template'] || DEFAULT_BILL_TEMPLATE).split(/\r?\n/)
    .map((item) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(key, value), item)).join('\n');
}
function buildReceipt(order, settings, type = 'BILL') {
  const width = String(settings['printer.bill.width'] || 'K80') === 'K58' ? 32 : 48;
  const body = renderBillTemplate(order, settings, type, width);
  const qr = order.qrPayload ? `\nVietQR:\n${order.qrPayload}` : '';
  return Buffer.concat([INIT, Buffer.from([0x1b, 0x61, 0x00]), line(body + qr), Buffer.from([0x0a, 0x0a]), CUT]);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const DEFAULT_HTML_TEMPLATE = `<div class="receipt"><div class="center"><strong>{{store.name}}</strong><div>{{store.address}}</div><div>{{store.phone}}</div><div class="divider"></div><strong>{{title}}</strong></div><div class="meta"><span>HĐ: #{{order.id}}</span><span>Bàn: {{order.table}}</span></div><div class="meta"><span>Ngày: {{order.date}}</span><span>Giờ: {{order.time}}</span></div><div class="divider"></div><table><thead><tr><th>Món</th><th>SL</th><th>T.Tiền</th></tr></thead><tbody>{{items}}</tbody></table><div class="divider"></div><table class="total-block"><tr><td>Tổng tiền món:</td><td>{{subtotal}}</td></tr><tr><td>VAT:</td><td>{{vat}}</td></tr><tr class="grand-total"><td>THANH TOÁN:</td><td>{{total}} đ</td></tr></table><div class="divider"></div>{{qr}}<div class="center footer">{{footer}}</div></div>`;
function renderEditableHtml(order, settings, type) {
  const items = (order.details || []).map((detail) => `<tr><td>${escapeHtml(detail.product_name)}</td><td>${escapeHtml(detail.quantity)}</td><td>${escapeHtml(money(detail.amount))}</td></tr>`).join('');
  const qr = order.qrPayload && settings['payment.bank.bin'] && settings['payment.bank.account']
    ? `<img class="qr-code" src="https://api.vietqr.io/image/${encodeURIComponent(settings['payment.bank.bin'])}-${encodeURIComponent(settings['payment.bank.account'])}-compact2.png?amount=${Math.round(order.grand_total || 0)}&addInfo=${encodeURIComponent(order.id || '')}" alt="VietQR">`
    : '';
  const values = {
    '{{store.name}}': settings['store.name'] || 'NinoPOS', '{{store.address}}': settings['store.address'] || '',
    '{{store.phone}}': settings['store.phone'] || '', '{{title}}': type === 'DRAFT' ? 'PHIẾU TẠM TÍNH' : type === 'BAR' ? 'PHIẾU PHA CHẾ (BAR)' : type === 'KITCHEN' ? 'PHIẾU CHẾ BIẾN (BẾP)' : 'PHIẾU THANH TOÁN',
    '{{order.id}}': order.id || '', '{{order.table}}': order.table_name || 'Mang đi', '{{order.customer}}': order.customer_name || 'Vãng lai',
    '{{order.date}}': new Date().toLocaleDateString('vi-VN'), '{{order.time}}': new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    '{{items}}': items, '{{subtotal}}': money(order.subtotal), '{{vat}}': money(order.vat_amount), '{{total}}': money(order.grand_total),
    '{{payment}}': order.payment_method ? order.payment_method.split(':')[0] : '', '{{qr}}': qr, '{{footer}}': settings['printer.bill.footer'] || 'Cảm ơn Quý khách!',
  };
  return Object.entries(values).reduce((html, [key, value]) => html.replaceAll(key, value), settings['printer.bill.html_template'] || DEFAULT_HTML_TEMPLATE);
}
function buildReceiptHtml(order, settings, type = 'BILL') {
  const items = (order.details || []).map((detail) => `<tr><td>${escapeHtml(detail.product_name)}</td><td class="qty">${escapeHtml(detail.quantity)}</td><td class="amount">${escapeHtml(money(detail.amount))}</td></tr>`).join('');
  const qr = order.qrPayload && settings['payment.bank.bin'] && settings['payment.bank.account']
    ? `https://api.vietqr.io/image/${encodeURIComponent(settings['payment.bank.bin'])}-${encodeURIComponent(settings['payment.bank.account'])}-compact2.png?amount=${Math.round(order.grand_total || 0)}&addInfo=${encodeURIComponent(order.id || '')}`
    : '';
  const editableTemplate = settings['printer.bill.html_template'];
  if (editableTemplate) return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0;size:80mm auto}body{width:72mm;margin:0 auto;padding:10px 0;font-family:"Courier New",monospace;font-size:13px;line-height:1.3;color:#000}
    .center{text-align:center}.meta{display:flex;justify-content:space-between;gap:6px}.divider{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th{text-align:left;border-bottom:1px dashed #000;padding-bottom:4px}td{padding:3px 0;vertical-align:top;overflow-wrap:anywhere}
    th:first-child,td:first-child{width:48%}th:nth-child(2),td:nth-child(2){width:14%;text-align:center}th:last-child,td:last-child{text-align:right;width:38%;white-space:nowrap}
    .total-block td:first-child{width:62%}.total-block td:last-child{width:38%}.grand-total{font-weight:bold;font-size:16px}.qr-code{display:block;margin:8px auto;width:130px;height:130px;filter:grayscale(1) contrast(200%)}.footer{text-align:center;margin-top:8px}
  </style></head><body>${renderEditableHtml(order, settings, type)}</body></html>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0;size:80mm auto}body{width:72mm;margin:0 auto;padding:10px 0;font-family:"Courier New",monospace;font-size:13px;line-height:1.3;color:#000}
    .center{text-align:center}.right{text-align:right}.bold{font-weight:bold}.title{font-size:16px;margin:4px 0}.divider{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th{text-align:left;border-bottom:1px dashed #000;padding-bottom:4px}td{padding:3px 0;vertical-align:top;overflow-wrap:anywhere}
    th:first-child,td:first-child{width:48%}th:nth-child(2),td:nth-child(2){width:14%;text-align:center}.amount{width:38%;text-align:right;white-space:nowrap}
    .total-block td{padding:2px 0}.total-block td:first-child{width:62%}.total-block td:last-child{width:38%;text-align:right;white-space:nowrap}.grand-total{font-size:16px}    .qr-code{display:block;margin:8px auto;width:130px;height:130px;image-rendering:auto;filter:grayscale(1) contrast(200%)}
  </style></head><body><div class="center"><div class="bold title">${escapeHtml(settings['store.name'] || 'NinoPOS')}</div><div>${escapeHtml(settings['store.address'] || '')}</div><div>${escapeHtml(settings['store.phone'] || '')}</div><div class="divider"></div><div class="bold" style="font-size:15px">${type === 'BILL' ? 'PHIẾU THANH TOÁN' : type === 'DRAFT' ? 'PHIẾU TẠM TÍNH' : type === 'BAR' ? 'PHIẾU PHA CHẾ (BAR)' : 'PHIẾU CHẾ BIẾN (BẾP)'}</div></div>
  <table style="margin-top:5px"><tr><td>HĐ: #${escapeHtml(order.id)}</td><td class="right">Bàn: ${escapeHtml(order.table_name || 'Mang đi')}</td></tr><tr><td>Ngày: ${escapeHtml(new Date().toLocaleDateString('vi-VN'))}</td><td class="right">Giờ: ${escapeHtml(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }))}</td></tr></table>
  <div class="divider"></div><table><thead><tr><th>Món</th><th>SL</th><th class="right">T.Tiền</th></tr></thead><tbody>${items}</tbody></table><div class="divider"></div>
  <table class="total-block"><tr><td>Tổng tiền món:</td><td class="right">${escapeHtml(money(order.subtotal))}</td></tr><tr><td>VAT:</td><td class="right">${escapeHtml(money(order.vat_amount))}</td></tr><tr class="grand-total bold"><td style="padding-top:6px">THANH TOÁN:</td><td class="right" style="padding-top:6px">${escapeHtml(money(order.grand_total))} đ</td></tr></table>
  <div class="divider"></div>${qr ? `<div class="center"><img class="qr-code" src="${qr}" alt="QR VietQR"><div>Quét mã VietQR để thanh toán</div></div>` : ''}<div class="center" style="margin-top:8px">${escapeHtml(settings['printer.bill.footer'] || 'Cảm ơn & Hẹn gặp lại Quý khách!')}</div></body></html>`;
}

function buildReport(report, settings, format = 'A4') {
  const lines = [`${settings['store.name'] || 'NinoPOS'} - BAO CAO ${report.title || 'DOANH THU'}`, `Tu ${report.from || ''} den ${report.to || ''}`, '='.repeat(format === 'A5' ? 70 : 100)];
  (report.rows || []).forEach((row) => lines.push(`${row.label || ''} ${row.value || ''}`));
  lines.push('-'.repeat(format === 'A5' ? 70 : 100), settings['printer.report.footer'] || 'Bao cao noi bo NinoPOS');
  return Buffer.concat([INIT, ...lines.flatMap((item) => [line(item)]), Buffer.from([0x0a, 0x0a]), CUT]);
}

class PrinterService {
  constructor(database) { this.database = database; }
  async processPending(beforePrint = null) {
    const jobs = this.database.getPrintJobs('PENDING'); const results = [];
    for (const job of jobs) {
      try { this.database.markPrintJob(job.id, 'PRINTING'); await this.printJob(job, beforePrint); this.database.markPrintJob(job.id, 'DONE'); results.push({ id: job.id, status: 'DONE' }); }
      catch (error) { this.database.markPrintJob(job.id, 'FAILED', error.message); results.push({ id: job.id, status: 'FAILED', error: error.message }); }
    }
    return results;
  }
  async printJob(job, beforePrint = null) {
    const settings = this.database.getSettings();
    const order = JSON.parse(job.payload || '{}');
    const isBill = job.job_type === 'BILL' || job.job_type === 'DRAFT_BILL';
    const isBar = job.job_type === 'BAR' || job.job_type === 'BAR_TICKET';
    const receiptType = job.job_type === 'DRAFT_BILL' ? 'DRAFT' : isBill ? 'BILL' : isBar ? 'BAR' : 'KITCHEN';
    const payload = job.job_type === 'DRAWER_OPEN' ? DRAWER : job.job_type === 'REPORT' ? buildReport(order, settings, order.format || 'A4') : buildReceipt(order, settings, receiptType);
    if (beforePrint) await beforePrint(job, payload);
    const profile = this.getProfile(settings, job.job_type === 'REPORT' ? 'report' : isBill ? 'bill' : isBar ? 'bar' : 'kitchen');
    return this.sendProfile(profile, payload);
  }
  getProfile(settings, type) {
    const prefix = `printer.${type}.`;
    return { kind: settings[`${prefix}kind`] || settings['printer.kind'] || 'Network', name: settings[`${prefix}name`] || settings['printer.name'], host: settings[`${prefix}host`] || settings['printer.host'], port: settings[`${prefix}port`] || settings['printer.port'] || 9100 };
  }
  async testPrinter(type, config) {
    const settings = this.database.getSettings();
    const profile = { kind: config.kind, name: config.name, host: config.kind === 'Network' ? config.name : '', port: config.port || 9100 };
    const payload = buildReceipt({ id: `TEST-${type.toUpperCase()}`, table_name: 'TEST', details: [], subtotal: 0, vat_amount: 0, grand_total: 0 }, settings, 'TEST PRINT');
    await this.sendProfile(profile, payload);
    return true;
  }
  sendProfile(profile, payload) {
    const kind = String(profile.kind || 'Network').toLowerCase();
    if (kind.includes('network') || kind.includes('lan') || kind.includes('tcp')) return this.sendTcp(profile.host || profile.name, Number(profile.port || 9100), payload);
    if (kind.includes('serial') || kind.includes('com')) return this.sendSerial(profile.name, payload);
    return this.sendSpooler(profile.name, payload);
  }
  sendTcp(host, port, payload) {
    if (!host) throw new Error('Chưa cấu hình IP máy in LAN.');
    return new Promise((resolve, reject) => { const socket = net.createConnection({ host, port }, () => { socket.end(payload); }); socket.setTimeout(5000, () => socket.destroy(new Error('Timeout máy in LAN.'))); socket.on('error', reject); socket.on('close', () => resolve()); });
  }
  sendSerial(portName, payload) {
    let SerialPort; try { ({ SerialPort } = require('serialport')); } catch { throw new Error('Chưa cài serialport/native driver cho COM.'); }
    return new Promise((resolve, reject) => { const port = new SerialPort({ path: portName, baudRate: 115200, autoOpen: false }); port.open((error) => { if (error) return reject(error); port.write(payload, (writeError) => { port.close(); writeError ? reject(writeError) : resolve(); }); }); });
  }
  sendSpooler(printerName, payload) {
    if (!printerName) throw new Error('Chưa cấu hình tên máy in Windows.');
    return new Promise((resolve, reject) => { const script = `$p='${String(printerName).replace(/'/g, "''")}'; $b=[IO.File]::ReadAllBytes('${this.writeTemp(payload)}'); [IO.File]::WriteAllBytes('\\\\localhost\\$p',$b)`; execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (error) => error ? reject(error) : resolve()); });
  }
  writeTemp(payload) { const fs = require('fs'); const path = require('path'); const file = path.join(require('os').tmpdir(), `ninopos-print-${Date.now()}.bin`); fs.writeFileSync(file, payload); return file.replace(/'/g, "''"); }
}
module.exports = { PrinterService, buildReceipt, buildReceiptHtml, buildReport };
