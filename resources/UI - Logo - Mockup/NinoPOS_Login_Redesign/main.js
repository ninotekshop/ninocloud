const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { PosDatabase } = require('./database');
const { readProducts, writeProducts } = require('./excel');
const { PrinterService } = require('./printer');
const QRCode = require('qrcode');
const bankDataPath = path.resolve(__dirname, '../../packages/api-contracts/data/napas-bank-bins.json');

let database;
let printer;
let currentSession = null;

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

function registerIpc() {
  ipcMain.handle('pos:window:minimize', (event) => { BrowserWindow.fromWebContents(event.sender)?.minimize(); return true; });
  ipcMain.handle('pos:window:toggle-maximize', (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; if (window.isMaximized()) window.unmaximize(); else window.maximize(); return window.isMaximized(); });
  ipcMain.handle('pos:window:close', (event) => { BrowserWindow.fromWebContents(event.sender)?.close(); return true; });
  ipcMain.handle('pos:auth:login', (_event, username, password) => { currentSession = database.authenticate(username, password); return currentSession; });
  ipcMain.handle('pos:auth:users', () => database.listUsers().map((user) => ({ id: user.id, username: user.username, full_name: user.full_name, role: user.role, status: user.status })));
  ipcMain.handle('pos:auth:pin', (_event, pin, userId = null) => { currentSession = database.authenticatePin(pin, userId); return currentSession; });
  ipcMain.handle('pos:auth:current', () => currentSession);
  ipcMain.handle('pos:auth:logout', () => { currentSession = null; return true; });
  ipcMain.handle('pos:auth:credentials', (_event, currentPassword, nextPassword, nextPin) => { if (!currentSession) throw new Error('Chưa đăng nhập.'); currentSession = database.updateOwnCredentials(currentSession.id, currentPassword, nextPassword, nextPin); return currentSession; });
  ipcMain.handle('pos:payments:banks', () => { requirePermission('settings.manage'); const source = fs.existsSync(bankDataPath) ? bankDataPath : path.join(process.resourcesPath, 'napas-bank-bins.json'); return JSON.parse(fs.readFileSync(source, 'utf8')).banks.filter((bank) => bank.transferSupported); });
  ipcMain.handle('pos:settings:upload-logo', async () => {
    requirePermission('settings.manage');
    const selected = await dialog.showOpenDialog({ title: 'Chọn logo thương hiệu', properties: ['openFile'], filters: [{ name: 'Ảnh logo', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const directory = path.join(app.getPath('userData'), 'branding'); fs.mkdirSync(directory, { recursive: true });
    const source = selected.filePaths[0]; const ext = path.extname(source).toLowerCase(); const destination = path.join(directory, `logo${ext}`); fs.copyFileSync(source, destination);
    return { canceled: false, imageUrl: pathToFileURL(destination).toString() };
  });
  ipcMain.handle('pos:bootstrap', () => ({
    areas: database.getAreas(),
    tables: database.getTables(),
    categories: database.getCategories(),
    products: database.getProducts(),
    settings: database.getSettings(),
  }));
  ipcMain.handle('pos:products', (_event, query = '', category = 'all') => database.getProducts(query, category));
  ipcMain.handle('pos:inventory:low-stock', () => { requirePermission('inventory.manage'); return database.getLowStockProducts(); });
  ipcMain.handle('pos:inventory:transactions', (_event, productId = null) => { requirePermission('inventory.view_cost'); return database.getStockTransactions(productId); });
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
  ipcMain.handle('pos:areas:delete', (_event, id) => { requirePermission('table.manage'); return database.deleteArea(id); });
  ipcMain.handle('pos:tables:create', (_event, payload) => { requirePermission('table.manage'); return database.createTable(payload); });
  ipcMain.handle('pos:tables:update', (_event, id, patch) => { requirePermission('table.manage'); return database.updateTable(id, patch); });
  ipcMain.handle('pos:tables:delete', (_event, id) => { requirePermission('table.manage'); return database.deleteTable(id); });
  ipcMain.handle('pos:orders:list-open', () => { requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.getOpenOrders(); });
  ipcMain.handle('pos:order:open', (_event, tableId) => { const session = requirePermission('table.open'); return database.openOrder(tableId, session.id); });
  ipcMain.handle('pos:order:add-item', (_event, orderId, productId, quantity = 1, note = '') => { requirePermission('order.add'); return database.addOrderItem(orderId, productId, quantity, note); });
  ipcMain.handle('pos:order:update-detail', (_event, detailId, quantity) => { requirePermission('order.delete_unprinted'); return database.updateDetail(detailId, quantity); });
  ipcMain.handle('pos:order:cancel-printed-detail', (_event, detailId) => { const session = requirePermission('order.cancel_printed'); return database.cancelPrintedDetail(detailId, session.id); });
  ipcMain.handle('pos:order:send-kitchen', (_event, orderId) => { requirePermission('order.kitchen'); return database.sendToKitchen(orderId); });
  ipcMain.handle('pos:order:cancel', (_event, orderId) => { const session = requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.cancelOrder(orderId, session.id); });
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
  ipcMain.handle('pos:checkout', (_event, orderId, method, paid, trace) => { requirePermission('payment.collect'); return database.checkout(orderId, method, paid, trace); });
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
  ipcMain.handle('pos:promotions:list', () => { requirePermission('settings.manage'); return database.listPromotions(); });
  ipcMain.handle('pos:promotions:create', (_event, payload) => { requirePermission('settings.manage'); return database.createPromotion(payload); });
  ipcMain.handle('pos:promotions:delete', (_event, id) => { requirePermission('settings.manage'); return database.deletePromotion(id); });
  ipcMain.handle('pos:print:jobs', (_event, status = 'PENDING') => { requireRole('ADMIN', 'CASHIER', 'WAITER'); return database.getPrintJobs(status); });
  ipcMain.handle('pos:print:mark', (_event, id, status, error = null) => { requireRole('ADMIN', 'CASHIER'); return database.markPrintJob(id, status, error); });
  ipcMain.handle('pos:print:process', () => { requireRole('ADMIN', 'CASHIER'); return printer.processPending(); });
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    frame: false,
    show: true,
    backgroundColor: '#0f172a',
    title: 'NinoPOS - Quản Lý Bán Hàng & Tính Tiền',
    icon: path.join(__dirname, 'NinoPOS_logo_nobkg.png'),
    minimizable: true,
    maximizable: true,
    closable: true,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (!win.isMaximized()) win.maximize();
  });

  win.loadFile(path.join(__dirname, 'login.html'));
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  database = new PosDatabase(app.getPath('userData'));
  printer = new PrinterService(database);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (database) database.close();
  if (process.platform !== 'darwin') app.quit();
});
