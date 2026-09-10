const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { PosDatabase } = require('../../apps/nino-pos-electron/database');

let database;
let technicianAuthenticated = false;

function technicianKeyIsValid(value) {
  const expected = String(process.env.NINOPOS_TECHNICIAN_KEY || '');
  const supplied = String(value || '');
  if (!expected || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function requireTechnician() {
  if (!technicianAuthenticated) throw new Error('Chưa xác thực kỹ thuật viên.');
}

function createWindow() {
  const window = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    title: 'NinoPOS - Công cụ kỹ thuật viên',
    icon: path.join(__dirname, '../../apps/nino-pos-electron/assets/ninopos-logo.ico'),
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  database = new PosDatabase(path.join(app.getPath('appData'), 'ninopos-desktop'));
  ipcMain.handle('technician:authenticate', (_event, key) => {
    technicianAuthenticated = technicianKeyIsValid(key);
    if (!technicianAuthenticated) throw new Error('Khóa kỹ thuật viên không đúng hoặc chưa được cấu hình.');
    return true;
  });
  ipcMain.handle('technician:users', () => {
    requireTechnician();
    return database.listUsers().map(({ id, username, full_name, role, status, created_at }) => ({ id, username, full_name, role, status, created_at }));
  });
  ipcMain.handle('technician:generate-admin-recovery', () => {
    requireTechnician();
    return database.generateAdminRecoveryCode();
  });
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
