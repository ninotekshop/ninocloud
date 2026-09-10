const { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { PosDatabase } = require('./database');
const { readProducts, writeProducts } = require('./excel');
const { PrinterService, buildReceipt, buildReceiptHtml } = require('./printer');
const LanServer = require('./lan-server');
const QRCode = require('qrcode');
const { getMachineId, verifyLicense, getTrialStatus, fetchRevocationManifest, verifyRevocationManifest } = require('./license');
const bankDataPath = path.resolve(__dirname, '../../packages/api-contracts/data/napas-bank-bins.json');

let database;
let printer;
let lanServer;
let mainWindow = null;
let tray = null;
let currentSession = null;
app.isQuitting = false;

const os = require('os');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function isVirtualPrinter(name) {
  return /microsoft print to pdf|microsoft xps document writer|onenote|fax/i.test(String(name || ''));
}

async function openPrinterPreview(type, config) {
  const parent = BrowserWindow.fromWebContents(config.sender);
  const settings = database.getSettings();
  const order = {
    id: `TEST-${String(type).toUpperCase()}`,
    table_name: 'TEST',
    details: [{ product_name: 'Mẫu bill thử', quantity: 1, amount: 0 }],
    subtotal: 0,
    vat_amount: 0,
    grand_total: 0,
    payment_method: 'CASH',
  };
  const html = buildReceiptHtml(order, settings, type === 'DRAFT_BILL' ? 'DRAFT' : 'BILL');
  const previewWindow = new BrowserWindow({
    width: 520,
    height: 760,
    parent,
    modal: Boolean(parent),
    show: false,
    webPreferences: { sandbox: true },
  });
  await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return new Promise((resolve, reject) => {
    previewWindow.webContents.print({
      silent: false,
      printBackground: true,
      deviceName: config.name,
    }, (success, failureReason) => {
      if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close();
      if (success) resolve(true);
      else reject(new Error(failureReason || 'Không thể mở hộp thoại in.'));
    });
  });
}

async function openReceiptPreview(sender, payload, title = 'Xem trước bill', order = {}, settings = {}) {
  const parent = BrowserWindow.fromWebContents(sender);
  const html = buildReceiptHtml(order, settings, title.includes('bếp') ? 'KITCHEN' : 'BILL');
  const previewWindow = new BrowserWindow({ width: 520, height: 760, parent, modal: Boolean(parent), show: false, webPreferences: { sandbox: true } });
  await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return new Promise((resolve, reject) => {
    previewWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      if (!previewWindow.isDestroyed()) previewWindow.close();
      success ? resolve(true) : reject(new Error(failureReason || 'Đã hủy xem trước/in bill.'));
    });
  });
}

app.commandLine.appendSwitch('force-renderer-accessibility');

function requireRole(...roles) {
  if (!currentSession) throw new Error('Chưa đăng nhập.');
  if (!roles.includes(currentSession.role)) throw new Error(`Role ${currentSession.role} không được phép thao tác.`);
  return currentSession;
}
function requirePermission(permission) {
  const session = requireRole('ADMIN', 'CASHIER', 'WAITER');
  if (!database.userHasPermission(session.id, permission)) throw new Error(`Bạn không có quyền: ${permission}`);
  return session;
}

function readLocalRevocationManifest() {
  const localPath = path.resolve(__dirname, '../../tools/license-admin/revocations.json');
  if (!fs.existsSync(localPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  } catch (error) {
    console.warn(`Không đọc được manifest thu hồi cục bộ: ${error.message}`);
    return null;
  }
}

async function getLicenseStatus() {
  const settings = database.getSettings();
  const now = Date.now();
  const lastSeen = Number(settings['license.last_seen_at'] || 0);
  if (lastSeen && now + 60000 < lastSeen) {
    return {
      machineId: getMachineId(),
      key: settings['license.key'] || '',
      valid: false,
      clockRollback: true,
      reason: 'Phát hiện ngày giờ hệ thống bị lùi. Vui lòng khôi phục ngày giờ chính xác để tiếp tục sử dụng.',
      lastSeenAt: new Date(lastSeen).toISOString(),
    };
  }
  database.setSetting('license.last_seen_at', new Date(now).toISOString());
  const key = settings['license.key'] || '';
  if (key) {
    const result = verifyLicense(key);
    const revocationUrl = settings['license.revocation_url'] || process.env.NINOPOS_REVOCATION_URL || '';
    const manifest = verifyRevocationManifest(
      (await fetchRevocationManifest(revocationUrl)) || (!revocationUrl ? readLocalRevocationManifest() : null),
    );
    if (result.valid && manifest) {
      const fingerprint = require('crypto').createHash('sha256').update(key).digest('hex').toUpperCase();
      const revoked = Array.isArray(manifest.revoked) && manifest.revoked.some((item) => item.key_sha256 ? item.key_sha256 === fingerprint : item.machine_id === getMachineId());
      if (revoked) return { machineId: getMachineId(), key, ...result, valid: false, revoked: true, reason: 'License đã bị thu hồi. Vui lòng liên hệ NINOTEK để được hỗ trợ.' };
    }
    return { machineId: getMachineId(), key, ...result, revocationChecked: Boolean(manifest), revocationUrl: revocationUrl || 'local-development-manifest' };
  }
  let trialStartedAt = settings['license.trial_started_at'];
  if (!trialStartedAt) { trialStartedAt = new Date(now).toISOString(); database.setSetting('license.trial_started_at', trialStartedAt); }
  return { machineId: getMachineId(), key, ...getTrialStatus(trialStartedAt) };
}

async function requireActiveLicense() {
  const status = await getLicenseStatus();
  if (!status.valid) throw new Error(status.reason || 'License chưa được kích hoạt.');
  return status;
}

function registerIpc() {
  ipcMain.handle('pos:lan:status', () => ({
    running: Boolean(lanServer && lanServer.running),
    port: lanServer ? lanServer.port : 8080,
    pairingCode: lanServer ? lanServer.pairingCode : '123456',
    ip: getLocalIpAddress(),
  }));
  ipcMain.handle('pos:lan:update-code', (_event, newCode) => {
    requirePermission('settings.manage');
    if (lanServer) lanServer.pairingCode = String(newCode).trim();
    return { pairingCode: lanServer.pairingCode };
  });
  ipcMain.handle('pos:window:minimize', (event) => { BrowserWindow.fromWebContents(event.sender)?.minimize(); return true; });
  ipcMain.handle('pos:window:toggle-maximize', (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; if (window.isMaximized()) window.unmaximize(); else window.maximize(); return window.isMaximized(); });
  ipcMain.handle('pos:window:close', (event) => { BrowserWindow.fromWebContents(event.sender)?.close(); return true; });
  ipcMain.handle('pos:auth:login', async (_event, username, password) => { await requireActiveLicense(); currentSession = database.authenticate(username, password); return currentSession; });
  ipcMain.handle('pos:auth:users', () => database.listUsers().map((user) => ({ id: user.id, username: user.username, full_name: user.full_name, role: user.role, status: user.status })));
  ipcMain.handle('pos:auth:pin', async (_event, pin, userId = null) => { await requireActiveLicense(); currentSession = database.authenticatePin(pin, userId); return currentSession; });
  ipcMain.handle('pos:auth:current', async () => { if (currentSession) { try { await requireActiveLicense(); } catch (_) { currentSession = null; } } return currentSession; });
  ipcMain.handle('pos:auth:logout', () => { currentSession = null; return true; });
  ipcMain.handle('pos:auth:credentials', (_event, currentPassword, nextPassword, nextPin) => { if (!currentSession) throw new Error('Chưa đăng nhập.'); currentSession = database.updateOwnCredentials(currentSession.id, currentPassword, nextPassword, nextPin); return currentSession; });
  ipcMain.handle('pos:auth:recovery-generate', () => { requireRole('ADMIN'); return database.generateAdminRecoveryCode(); });
  ipcMain.handle('pos:auth:recovery-reset', async (_event, recoveryCode, nextPassword) => { await requireActiveLicense(); return database.resetAdminPassword(recoveryCode, nextPassword); });
  ipcMain.handle('pos:license:status', () => getLicenseStatus());
  ipcMain.handle('pos:license:activate', async (_event, key) => {
    const clockStatus = await getLicenseStatus();
    if (clockStatus.clockRollback) throw new Error(clockStatus.reason);
    const result = verifyLicense(key);
    if (!result.valid) throw new Error(result.reason);
    database.setSetting('license.key', String(key).trim());
    return { machineId: getMachineId(), key: String(key).trim(), ...result };
  });
  ipcMain.handle('pos:payments:banks', () => {
    requirePermission('settings.manage');
    const defaultBanks = [
      { bin: '970436', shortName: 'VCB', name: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)' },
      { bin: '970407', shortName: 'TCB', name: 'Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)' },
      { bin: '970422', shortName: 'MB', name: 'Ngân hàng TMCP Quân Đội (MB Bank)' },
      { bin: '970418', shortName: 'BIDV', name: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)' },
      { bin: '970405', shortName: 'Agribank', name: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam (Agribank)' },
      { bin: '970432', shortName: 'VPBank', name: 'Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)' },
      { bin: '970416', shortName: 'ACB', name: 'Ngân hàng TMCP Á Châu (ACB)' },
      { bin: '970423', shortName: 'TPB', name: 'Ngân hàng TMCP Tiên Phong (TPBank)' },
      { bin: '970403', shortName: 'Sacombank', name: 'Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)' },
      { bin: '970415', shortName: 'CTG', name: 'Ngân hàng TMCP Công Thương Việt Nam (VietinBank)' },
      { bin: '970437', shortName: 'HDBank', name: 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh (HDBank)' },
      { bin: '970441', shortName: 'VIB', name: 'Ngân hàng TMCP Quốc tế Việt Nam (VIB)' },
      { bin: '970428', shortName: 'NamABank', name: 'Ngân hàng TMCP Nam Á (Nam A Bank)' },
      { bin: '970443', shortName: 'SHB', name: 'Ngân hàng TMCP Sài Gòn - Hà Nội (SHB)' }
    ];
    try {
      const candidates = [
        bankDataPath,
        path.join(process.resourcesPath || '', 'napas-bank-bins.json'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked/packages/api-contracts/data/napas-bank-bins.json'),
        path.resolve(__dirname, '../../packages/api-contracts/data/napas-bank-bins.json')
      ];
      for (const p of candidates) {
        if (p && fs.existsSync(p)) {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
          const list = Array.isArray(parsed) ? parsed : (parsed.banks || []);
          if (list.length > 0) {
            return list.filter((b) => b.transferSupported !== false);
          }
        }
      }
    } catch (_) {}
    return defaultBanks;
  });
  ipcMain.handle('pos:settings:upload-logo', async () => {
    requirePermission('settings.manage');
    const selected = await dialog.showOpenDialog({ title: 'Chọn logo thương hiệu', properties: ['openFile'], filters: [{ name: 'Ảnh logo', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const directory = path.join(app.getPath('userData'), 'branding'); fs.mkdirSync(directory, { recursive: true });
    const source = selected.filePaths[0]; const ext = path.extname(source).toLowerCase(); const destination = path.join(directory, `logo${ext}`); fs.copyFileSync(source, destination);
    return { canceled: false, imageUrl: pathToFileURL(destination).toString() };
  });
  ipcMain.handle('pos:bootstrap', async () => ({
    areas: database.getAreas(),
    tables: database.getTables(),
    categories: database.getCategories(),
    products: database.getProducts(),
    settings: database.getSettings(),
    license: await getLicenseStatus(),
  }));
  ipcMain.handle('pos:lan:info', () => {
    return {
      ip: getLocalIpAddress() || '127.0.0.1',
      port: lanServer ? lanServer.port : 8080
    };
  });
  ipcMain.handle('pos:products', (_event, query = '', category = 'all') => database.getProducts(query, category));
  ipcMain.handle('pos:inventory:low-stock', () => { requirePermission('inventory.manage'); return database.getLowStockProducts(); });
  ipcMain.handle('pos:inventory:transactions', (_event, productId = null) => { requirePermission('inventory.view_cost'); return database.getStockTransactions(productId); });
  ipcMain.handle('pos:inventory:receive', (_event, payload) => { requirePermission('inventory.manage'); return database.receiveStock({ ...payload, user_id: currentSession.id }); });
  ipcMain.handle('pos:inventory:document-create', (_event, payload) => { requirePermission('inventory.manage'); return database.createStockDocument({ ...payload, user_id: currentSession.id }); });
  ipcMain.handle('pos:inventory:documents', (_event, type = 'ALL') => { requirePermission('inventory.manage'); return database.listStockDocuments(type); });
  ipcMain.handle('pos:inventory:document-detail', (_event, id) => { requirePermission('inventory.manage'); return database.getStockDocument(id); });
  ipcMain.handle('pos:inventory:document-update', (_event, id, payload) => { requireRole('ADMIN'); return database.updateStockDocument(id, { ...payload, user_id: currentSession.id }); });
  ipcMain.handle('pos:inventory:document-delete', (_event, id) => { requireRole('ADMIN'); return database.deleteStockDocument(id, currentSession.id); });
  ipcMain.handle('pos:inventory:recipes', (_event, productId) => { requirePermission('inventory.manage'); return database.getRecipes(productId); });
  ipcMain.handle('pos:inventory:recipe-save', (_event, productId, items) => { requirePermission('inventory.manage'); return database.saveRecipe(productId, items); });
  ipcMain.handle('pos:products:create', (_event, payload) => { requirePermission('inventory.manage'); return database.createProduct(payload); });
  ipcMain.handle('pos:products:update', (_event, id, patch) => { requirePermission('inventory.manage'); return database.updateProduct(id, patch); });
  ipcMain.handle('pos:products:delete', (_event, id) => { requirePermission('inventory.manage'); return database.deleteProduct(id); });
  ipcMain.handle('pos:products:upload-image', async () => {
    requireRole('ADMIN');
    const selected = await dialog.showOpenDialog({
      title: 'Chọn ảnh sản phẩm',
      properties: ['openFile'],
      filters: [{ name: 'Ảnh sản phẩm', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const source = selected.filePaths[0];
    const imageDirectory = path.join(app.getPath('userData'), 'product-images');
    fs.mkdirSync(imageDirectory, { recursive: true });
    const extension = path.extname(source).toLowerCase();
    const safeName = path.basename(source, extension).replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').slice(0, 60) || 'product';
    const destination = path.join(imageDirectory, `${Date.now()}-${safeName}${extension}`);
    fs.copyFileSync(source, destination);
    return { canceled: false, file: destination, imageUrl: pathToFileURL(destination).toString() };
  });
  ipcMain.handle('pos:tables', () => database.getTables());
  ipcMain.handle('pos:areas:list', () => database.getAreas());
  ipcMain.handle('pos:areas:create', (_event, payload) => { requirePermission('table.manage'); return database.createArea(payload); });
  ipcMain.handle('pos:areas:update', (_event, id, patch) => { requirePermission('table.manage'); return database.updateArea(id, patch); });
  ipcMain.handle('pos:areas:reorder', (_event, ids) => { requirePermission('table.manage'); return database.reorderAreas(ids); });
  ipcMain.handle('pos:areas:delete', (_event, id) => { requirePermission('table.manage'); return database.deleteArea(id); });
  ipcMain.handle('pos:tables:create', (_event, payload) => { requirePermission('table.manage'); return database.createTable(payload); });
  ipcMain.handle('pos:tables:update', (_event, id, patch) => { requirePermission('table.manage'); return database.updateTable(id, patch); });
  ipcMain.handle('pos:tables:reorder', (_event, areaId, ids) => { requirePermission('table.manage'); return database.reorderTables(areaId, ids); });
  ipcMain.handle('pos:tables:delete', (_event, id) => { requirePermission('table.manage'); return database.deleteTable(id); });
  ipcMain.handle('pos:orders:list-open', () => { requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.getOpenOrders(); });
  ipcMain.handle('pos:orders:get', (_event, orderId) => { requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.getOrder(orderId); });
  ipcMain.handle('pos:order:open', (_event, tableId) => { const session = requirePermission('table.open'); return database.openOrder(tableId, session.id); });
  ipcMain.handle('pos:order:add-item', (_event, orderId, productId, quantity = 1, note = '') => { requirePermission('order.add'); return database.addOrderItem(orderId, productId, quantity, note); });
  ipcMain.handle('pos:order:update-detail', (_event, detailId, quantity) => { requirePermission('order.delete_unprinted'); return database.updateDetail(detailId, quantity); });
  ipcMain.handle('pos:order:cancel-printed-detail', (_event, detailId) => { const session = requirePermission('order.cancel_printed'); return database.cancelPrintedDetail(detailId, session.id); });
  ipcMain.handle('pos:order:send-kitchen', (_event, orderId) => { requirePermission('order.kitchen'); return database.sendToKitchen(orderId); });
  ipcMain.handle('pos:order:cancel', (_event, orderId) => { const session = requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.cancelOrder(orderId, session.id); });
  ipcMain.handle('pos:analytics:order', (_event, orderId) => { requirePermission('report.view'); return database.getOrder(orderId); });
  ipcMain.handle('pos:analytics:cancel-order', (_event, orderId, reason) => { const session = requireRole('ADMIN'); return database.cancelPaidOrder(orderId, reason, session.id); });
  ipcMain.handle('pos:order:move-table', (_event, orderId, tableId) => { const session = requirePermission('order.move'); return database.moveTable(orderId, tableId, session.id); });
  ipcMain.handle('pos:order:merge-tables', (_event, sourceOrderId, targetOrderId) => { const session = requirePermission('order.merge'); return database.mergeTables(sourceOrderId, targetOrderId, session.id); });
  ipcMain.handle('pos:audit:list', (_event, entityId = null) => { requireRole('ADMIN'); return database.getAuditLogs(entityId); });
  ipcMain.handle('pos:database:backup', async () => {
    requirePermission('settings.manage');
    const selected = await dialog.showSaveDialog({ title: 'Sao lưu cơ sở dữ liệu NinoPOS', defaultPath: `ninoPOS-backup-${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: 'SQLite database', extensions: ['db'] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    database.db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(database.file, selected.filePath);
    database.audit(currentSession.id, 'BACKUP_DATABASE', 'database', selected.filePath, null, { file: selected.filePath });
    return { canceled: false, file: selected.filePath };
  });
  ipcMain.handle('pos:checkout', (_event, orderId, method, paid, trace, customerId, redeemPoints) => { requirePermission('payment.collect'); return database.checkout(orderId, method, paid, trace, customerId, redeemPoints); });
  ipcMain.handle('pos:checkout:qr', async (_event, orderId) => { requirePermission('payment.collect'); const payload = database.createVietQr(orderId); return { payload, dataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 320 }) }; });
  ipcMain.handle('pos:print:temporary', (_event, orderId) => { requirePermission('payment.draft'); return database.printTemporary(orderId); });
  ipcMain.handle('pos:payments:cash', (_event, orderId, paid) => { requireRole('ADMIN', 'CASHIER'); return database.checkout(orderId, 'CASH', paid, ''); });
  ipcMain.handle('pos:payments:qr', (_event, orderId, trace = '') => { requireRole('ADMIN', 'CASHIER'); return database.checkout(orderId, 'VIETQR', 0, trace); });
  ipcMain.handle('pos:payments:card', (_event, orderId, trace) => { requireRole('ADMIN', 'CASHIER'); return database.checkout(orderId, 'CARD', 0, trace); });
  ipcMain.handle('pos:users:list', () => { requirePermission('settings.manage'); return database.listUsers(); });
  ipcMain.handle('pos:users:create', (_event, payload) => { requireRole('ADMIN'); return database.createUser(payload); });
  ipcMain.handle('pos:users:update', (_event, id, patch) => { requireRole('ADMIN'); return database.updateUser(id, patch); });
  ipcMain.handle('pos:permissions:catalog', () => { requireRole('ADMIN'); return database.getPermissionCatalog(); });
  ipcMain.handle('pos:permissions:get', (_event, userId) => { requireRole('ADMIN'); return database.getUserPermissions(userId); });
  ipcMain.handle('pos:permissions:update', (_event, userId, permissions) => { requireRole('ADMIN'); return database.updateUserPermissions(userId, permissions); });
  ipcMain.handle('pos:shift:open', (_event, initialCash) => { requirePermission('shift.open'); return database.openShift(currentSession.id, initialCash); });
  ipcMain.handle('pos:shift:current', () => { if (!currentSession) throw new Error('Chưa đăng nhập.'); return database.getOpenShift(currentSession.id); });
  ipcMain.handle('pos:shift:close', (_event, closingCash) => { requirePermission('shift.close'); return database.closeShift(currentSession.id, closingCash); });
  ipcMain.handle('pos:shift:report', (_event, shiftId) => { requirePermission('report.view'); return database.shiftReport(shiftId); });
  ipcMain.handle('pos:analytics:report', (_event, from, to) => { requirePermission('report.view'); return database.analyticsReport(from, to); });
  ipcMain.handle('pos:analytics:detail', (_event, type, from, to) => { requirePermission('report.view'); return database.analyticsDetail(type, from, to); });
  ipcMain.handle('pos:analytics:export', async (_event, title, headers, rows) => {
    requirePermission('report.export');
    const result = await dialog.showSaveDialog({ title: `Xuất ${title}`, defaultPath: `${title.replace(/\s+/g, '_')}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    fs.writeFileSync(result.filePath, `\ufeff${csv}`, 'utf8');
    return { canceled: false, file: result.filePath };
  });
  ipcMain.handle('pos:customers:list', (_event, query = '') => { requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.listCustomers(query); });
  ipcMain.handle('pos:customers:create', (_event, payload) => { requireRole('ADMIN', 'CASHIER'); return database.createCustomer(payload); });
  ipcMain.handle('pos:customers:update', (_event, id, patch) => { requirePermission('settings.manage'); return database.updateCustomer(id, patch); });
  ipcMain.handle('pos:customers:ledger', (_event, id) => { requireRole('ADMIN', 'CASHIER'); return database.getCustomerLedger(id); });
  ipcMain.handle('pos:customers:pay-debt', (_event, id, amount, method) => { requireRole('ADMIN', 'CASHIER'); return database.payCustomerDebt(id, amount, currentSession?.id, method); });
  ipcMain.handle('pos:promotions:list', () => { requirePermission('settings.manage'); return database.listPromotions(); });
  ipcMain.handle('pos:promotions:create', (_event, payload) => { requirePermission('settings.manage'); return database.createPromotion(payload); });
  ipcMain.handle('pos:promotions:delete', (_event, id) => { requirePermission('settings.manage'); return database.deletePromotion(id); });
  ipcMain.handle('pos:print:jobs', (_event, status = 'PENDING') => { requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.getPrintJobs(status); });
  ipcMain.handle('pos:print:mark', (_event, id, status, error = null) => { requireRole('ADMIN', 'CASHIER'); return database.markPrintJob(id, status, error); });
  ipcMain.handle('pos:print:process', (event) => {
    requireRole('ADMIN', 'CASHIER');
    const settings = database.getSettings();
    const preview = settings['printer.bill.preview_before_print'] === '1';
    return printer.processPending(preview ? async (job, payload) => {
      if (job.job_type === 'BILL' || job.job_type === 'DRAFT_BILL' || job.job_type === 'KITCHEN' || job.job_type === 'BAR') await openReceiptPreview(event.sender, payload, job.job_type === 'DRAFT_BILL' ? 'Xem trước phiếu tạm tính' : job.job_type === 'KITCHEN' || job.job_type === 'BAR' ? 'Xem trước phiếu bếp' : 'Xem trước bill', JSON.parse(job.payload || '{}'), settings);
    } : null);
  });
  ipcMain.handle('pos:printer:test', async (event, type, config) => { requirePermission('settings.manage'); if (config?.kind === 'WindowsSpooler' && isVirtualPrinter(config.name)) return openPrinterPreview(type, { ...config, sender: event.sender }); return printer.testPrinter(type, config); });
  ipcMain.handle('pos:printer:list', async (event) => {
    const printers = await event.sender.getPrintersAsync();
    return printers.map((item) => ({ name: item.name, displayName: item.displayName || item.name, status: item.status }));
  });
  ipcMain.handle('pos:report:print', (_event, title, from, to, format) => { requirePermission('report.view'); return database.queueReportPrint(title, from, to, format); });
  ipcMain.handle('pos:settings:set', (_event, key, value) => { requirePermission('settings.manage'); return database.setSetting(key, value); });
  ipcMain.handle('pos:products:import', async () => {
    const selected = await dialog.showOpenDialog({
      title: 'Nhập danh sách hàng hóa', properties: ['openFile'],
      filters: [{ name: 'Excel hoặc CSV', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    requirePermission('inventory.manage');
    const rows = readProducts(selected.filePaths[0]);
    return { canceled: false, imported: database.importProducts(rows), file: selected.filePaths[0] };
  });
  ipcMain.handle('pos:products:export', async () => {
    const selected = await dialog.showSaveDialog({
      title: 'Xuất danh sách hàng hóa', defaultPath: 'ninoPOS-hang-hoa.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    requirePermission('inventory.manage');
    writeProducts(selected.filePath, database.getAllProductsForExport());
    return { canceled: false, file: selected.filePath };
  });
  ipcMain.handle('pos:drawer:open', () => {
    requirePermission('payment.drawer');
    database.printJob('DRAWER_OPEN', JSON.stringify({ command: [0x1b, 0x70, 0x00, 0x19, 0xfa] }));
    return { queued: true };
  });
}

function createSystemTray() {
  if (tray) return;
  try {
    const icoPath = path.join(__dirname, 'assets', 'ninopos-logo.ico');
    const pngPath = path.join(__dirname, 'assets', 'ninopos-logo.png');
    let icon = nativeImage.createFromPath(icoPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createFromPath(pngPath);
    }
    tray = new Tray(icon);

    const updateMenu = () => {
      const isAutoStart = app.getLoginItemSettings().openAtLogin;
      const lanStatusText = lanServer && lanServer.server && lanServer.server.listening
        ? `🟢 LAN Server: Đang chạy (Port ${lanServer.port || 8080})`
        : `🔴 LAN Server: Chưa chạy`;

      const contextMenu = Menu.buildFromTemplate([
        { label: 'NinoPOS — Trạm Thu Ngân', enabled: false },
        { label: lanStatusText, enabled: false },
        { type: 'separator' },
        {
          label: 'Mở giao diện NinoPOS',
          click: () => {
            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        {
          label: 'Tự động chạy ngầm cùng Windows',
          type: 'checkbox',
          checked: isAutoStart,
          click: (item) => {
            app.setLoginItemSettings({
              openAtLogin: item.checked,
              path: app.getPath('exe'),
            });
            updateMenu();
          },
        },
        { type: 'separator' },
        {
          label: 'Thoát hoàn toàn NinoPOS',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ]);
      tray.setContextMenu(contextMenu);
    };

    tray.setToolTip('NinoPOS — Trạm thu ngân LAN Server (Port 8080)');
    updateMenu();

    const restoreWindow = () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    };

    tray.on('double-click', restoreWindow);
    tray.on('click', restoreWindow);
  } catch (err) {
    console.error('Lỗi khởi tạo System Tray:', err);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    icon: path.join(__dirname, 'assets', 'ninopos-logo.ico'),
    minWidth: 1024,
    minHeight: 720,
    frame: true,
    show: true,
    backgroundColor: '#0f172a',
    title: 'NinoPOS - Quản Lý Bán Hàng & Tính Tiền',
    minimizable: true,
    maximizable: true,
    closable: true,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  mainWindow = win;
  global.mainWindow = mainWindow;

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (!win.isMaximized()) win.maximize();
  });

  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
      return false;
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setMenuBarVisibility(false);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    database = new PosDatabase(app.getPath('userData'));
    printer = new PrinterService(database);
    lanServer = new LanServer(database, 8080);
    await lanServer.start();
    registerIpc();
    createWindow();
    createSystemTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (app.isQuitting) {
    if (database) database.close();
    if (process.platform !== 'darwin') app.quit();
  }
});
