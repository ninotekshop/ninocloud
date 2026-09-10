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
function buildReceipt(order, settings, type = 'BILL') {
  const chunks = [INIT, Buffer.from([0x1b, 0x61, 0x01]), Buffer.from([0x1b, 0x45, 0x01]), line(settings['store.name'] || 'NinoPOS'), Buffer.from([0x1b, 0x45, 0x00]), Buffer.from([0x1b, 0x61, 0x00]), line(settings['store.address'] || ''), line(settings['store.phone'] || ''), line('='.repeat(48)), line(type === 'BILL' ? 'HOA DON THANH TOAN' : 'PHIEU CHE BIEN'), line(`Ma don: ${order.id}`), line(`Ban: ${order.table_name || 'Mang di'}`), line('-'.repeat(48))];
  for (const detail of order.details || []) chunks.push(twoColumns(`${detail.product_name} x${detail.quantity}`, money(detail.amount)));
  chunks.push(line('-'.repeat(48)), twoColumns('Tam tinh', money(order.subtotal)), twoColumns('VAT', money(order.vat_amount)), twoColumns('TONG CONG', money(order.grand_total)));
  if (order.qrPayload) chunks.push(line('VietQR:'), line(order.qrPayload));
  chunks.push(line('Cam on quy khach!'), Buffer.from([0x0a, 0x0a]), CUT);
  return Buffer.concat(chunks);
}

class PrinterService {
  constructor(database) { this.database = database; }
  async processPending() {
    const jobs = this.database.getPrintJobs('PENDING'); const results = [];
    for (const job of jobs) {
      try { this.database.markPrintJob(job.id, 'PRINTING'); await this.printJob(job); this.database.markPrintJob(job.id, 'DONE'); results.push({ id: job.id, status: 'DONE' }); }
      catch (error) { this.database.markPrintJob(job.id, 'FAILED', error.message); results.push({ id: job.id, status: 'FAILED', error: error.message }); }
    }
    return results;
  }
  async printJob(job) {
    const settings = this.database.getSettings();
    const order = JSON.parse(job.payload || '{}');
    const payload = job.job_type === 'DRAWER_OPEN' ? DRAWER : buildReceipt(order, settings, job.job_type === 'BILL' ? 'BILL' : 'KITCHEN');
    const kind = String(settings['printer.kind'] || 'Network').toLowerCase();
    if (kind.includes('network') || kind.includes('lan')) return this.sendTcp(settings['printer.host'] || settings['printer.name'], Number(settings['printer.port'] || 9100), payload);
    if (kind.includes('serial') || kind.includes('com')) return this.sendSerial(settings['printer.name'], payload);
    return this.sendSpooler(settings['printer.name'], payload);
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
module.exports = { PrinterService, buildReceipt };
