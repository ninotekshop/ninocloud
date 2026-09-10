const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-renderer-accessibility');
app.setName('NinoPOS');
app.on('ready', () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    frame: true,
    show: true,
    resizable: true,
    title: 'NinoPOS - H? Th?ng Qu?n Lý & Tính Ti?n',
    backgroundColor: '#0b1020',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile('index.html');
  win.maximize();
  win.webContents.on('did-finish-load', () => {
    console.log('APP_READY');
  });
  win.on('ready-to-show', () => {
    console.log('READY_TO_SHOW');
  });
  win.on('show', () => {
    console.log('WINDOW_SHOWN');
  });
  win.on('closed', () => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
