const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

function sanitizeQrText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function tlv(tag, value) { return `${tag}${String(value.length).padStart(2, '0')}${value}`; }
function crc16(value) { let crc = 0xffff; for (const byte of Buffer.from(value, 'utf8')) { crc ^= byte << 8; for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; } return crc.toString(16).toUpperCase().padStart(4, '0'); }

const PERMISSION_DEFAULTS = {
  ADMIN: Object.fromEntries(['table.view','table.open','table.reserve','table.manage','order.add','order.note','order.kitchen','order.delete_unprinted','order.cancel_printed','order.move','order.merge','payment.draft','payment.discount','payment.collect','payment.drawer','payment.reprint','payment.void','shift.pin','shift.open','shift.close','inventory.view_cost','inventory.manage','report.view','report.export','settings.manage'].map((key) => [key, true])),
  CASHIER: { 'table.view': true, 'table.open': true, 'table.reserve': true, 'order.add': true, 'order.note': true, 'order.kitchen': true, 'order.delete_unprinted': true, 'order.cancel_printed': false, 'order.move': true, 'order.merge': true, 'payment.draft': true, 'payment.discount': true, 'payment.collect': true, 'payment.drawer': true, 'payment.reprint': true, 'payment.void': false, 'shift.pin': true, 'shift.open': true, 'shift.close': true, 'inventory.view_cost': false, 'inventory.manage': false, 'report.view': true, 'report.export': false, 'settings.manage': false },
  WAITER: { 'table.view': true, 'table.open': true, 'table.reserve': false, 'table.manage': false, 'order.add': true, 'order.note': true, 'order.kitchen': true, 'order.delete_unprinted': true, 'order.cancel_printed': false, 'order.move': true, 'order.merge': true, 'payment.draft': true, 'payment.discount': false, 'payment.collect': false, 'payment.drawer': false, 'payment.reprint': false, 'payment.void': false, 'shift.pin': true, 'shift.open': false, 'shift.close': false, 'inventory.view_cost': false, 'inventory.manage': false, 'report.view': false, 'report.export': false, 'settings.manage': false },
};

class PosDatabase {
  constructor(dataDirectory) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    this.file = path.join(dataDirectory, 'pos_data.db');
    this.db = new Database(this.file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    this.seed();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','CASHIER','WAITER')),
        pin_code TEXT, permissions_json TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS areas (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tables_pos (
        id TEXT PRIMARY KEY, area_id TEXT NOT NULL REFERENCES areas(id), name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'EMPTY', active_order_id TEXT, current_guest_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, category_id TEXT REFERENCES categories(id), name TEXT NOT NULL,
        cost_price REAL NOT NULL DEFAULT 0, selling_price REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'Phần', stock_quantity REAL NOT NULL DEFAULT 0,
        is_weighted INTEGER NOT NULL DEFAULT 0, image_url TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, table_id TEXT REFERENCES tables_pos(id), user_id TEXT NOT NULL,
        check_in_time TEXT NOT NULL, check_out_time TEXT, subtotal REAL NOT NULL DEFAULT 0,
        discount_type TEXT DEFAULT 'AMOUNT', discount_val REAL DEFAULT 0, vat_rate REAL DEFAULT 8,
        vat_amount REAL DEFAULT 0, grand_total REAL DEFAULT 0, payment_method TEXT,
        customer_paid REAL DEFAULT 0, change_amount REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'SERVING', note TEXT
      );
      CREATE TABLE IF NOT EXISTS order_details (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
        quantity REAL NOT NULL, price REAL NOT NULL, amount REAL NOT NULL,
        is_printed_kitchen INTEGER DEFAULT 0, note TEXT
      );
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT,
        initial_cash REAL DEFAULT 0, total_cash_sales REAL DEFAULT 0, total_qr_sales REAL DEFAULT 0,
        total_card_sales REAL DEFAULT 0, closing_cash REAL, status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS print_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, printer TEXT NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', retry_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity_type TEXT,
        entity_id TEXT, old_value TEXT, new_value TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stock_transactions (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, order_id TEXT, user_id TEXT,
        transaction_type TEXT NOT NULL, quantity_change REAL NOT NULL,
        quantity_after REAL NOT NULL, note TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS promotions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, discount_type TEXT NOT NULL,
        discount_value REAL NOT NULL DEFAULT 0, starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL
      );
    `);
    try { this.db.exec("ALTER TABLE products ADD COLUMN min_stock_quantity REAL NOT NULL DEFAULT 5"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    try { this.db.exec("ALTER TABLE products ADD COLUMN image_url TEXT"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    try { this.db.exec("ALTER TABLE users ADD COLUMN permissions_json TEXT"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  }

  seed() {
    const now = new Date().toISOString();
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count === 0) {
      const passwordHash = PosDatabase.hashPassword('ninotek@123');
      this.db.prepare(`INSERT INTO users(id,username,password_hash,full_name,role,pin_code,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run('user-admin', 'admin', passwordHash, 'Nguyen Van Chu', 'ADMIN', '1234', now);
      this.db.prepare(`INSERT INTO users(id,username,password_hash,full_name,role,pin_code,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run('user-cashier', 'cashier', passwordHash, 'Tran Thi Thu Ngan', 'CASHIER', '1111', now);
      this.db.prepare(`INSERT INTO users(id,username,password_hash,full_name,role,pin_code,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run('user-waiter', 'waiter', passwordHash, 'Le Van Phuc Vu', 'WAITER', '2222', now);
    }

    const areas = [
      ['area-garden', 'Khu Sân Vườn', 1], ['area-floor1', 'Tầng 1', 2],
      ['area-vip', 'Phòng VIP', 3], ['area-bar', 'Quầy Bar', 4],
    ];
    const addArea = this.db.prepare('INSERT OR IGNORE INTO areas(id,name,sort_order) VALUES(?,?,?)');
    for (const area of areas) addArea.run(...area);

    const tableCount = this.db.prepare('SELECT COUNT(*) AS count FROM tables_pos').get().count;
    if (tableCount === 0) {
      const addTable = this.db.prepare('INSERT INTO tables_pos(id,area_id,name,status,current_guest_count) VALUES(?,?,?,?,?)');
      for (let i = 1; i <= 8; i++) addTable.run(`table-${i}`, 'area-garden', `Bàn T-${String(i).padStart(2, '0')}`, 'EMPTY', 0);
      for (let i = 1; i <= 4; i++) addTable.run(`floor-${i}`, 'area-floor1', `Tầng 1 - B${i}`, 'EMPTY', 0);
      for (let i = 1; i <= 2; i++) addTable.run(`vip-${i}`, 'area-vip', `Phòng VIP ${i}`, 'EMPTY', 0);
      addTable.run('bar-1', 'area-bar', 'Quầy Bar', 'EMPTY', 0);
    }

    const categoryCount = this.db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
    if (categoryCount === 0) {
      const addCategory = this.db.prepare('INSERT INTO categories(id,name,icon,sort_order) VALUES(?,?,?,?)');
      [['khaivi', 'Khai vị', 'fa-seedling', 1], ['monchinh', 'Món chính', 'fa-bowl-food', 2], ['launuong', 'Lẩu & Nướng', 'fa-fire-burner', 3], ['biaruo', 'Bia & Rượu', 'fa-beer-mug-empty', 4], ['giaikhat', 'Nước ngọt & Cafe', 'fa-glass-water', 5], ['anvat', 'Đồ ăn vặt', 'fa-cookie-bite', 6]].forEach((x) => addCategory.run(...x));
    }

    const productCount = this.db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    if (productCount === 0) {
      const products = [
        ['SP01', 'launuong', 'Lẩu Thái Hải Sản (Nồi nhỏ)', 110000, 180000, 'Nồi', 20, 0, 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80'],
        ['SP02', 'launuong', 'Lẩu Thái Hải Sản (Nồi lớn)', 180000, 280000, 'Nồi', 20, 0, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80'],
        ['SP03', 'khaivi', 'Cánh Gà Chiên Nước Mắm', 55000, 95000, 'Đĩa', 50, 0, 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?auto=format&fit=crop&w=900&q=80'],
        ['SP04', 'launuong', 'Mực Trứng Nướng Muối Ớt', 95000, 160000, 'Đĩa', 30, 0, 'https://images.unsplash.com/photo-1534482421-64566f976cfa?auto=format&fit=crop&w=900&q=80'],
        ['SP05', 'monchinh', 'Bò Tơ Cuộn Nấm Kim Châm', 90000, 150000, 'Đĩa', 30, 0, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80'],
        ['SP06', 'biaruo', 'Bia Tiger Nâu (Két 24 lon)', 320000, 420000, 'Két', 15, 0, 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=80'],
        ['SP07', 'biaruo', 'Bia Heineken Bạc (Két 24 lon)', 370000, 480000, 'Két', 15, 0, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80'],
        ['SP08', 'biaruo', 'Bia 333 (Thùng 24 lon)', 290000, 380000, 'Thùng', 15, 0, 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=900&q=80'],
        ['SP09', 'biaruo', 'Bia Tiger (Lon lẻ)', 12000, 20000, 'Lon', 100, 0, 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?auto=format&fit=crop&w=900&q=80'],
        ['SP10', 'giaikhat', 'Trà Đào Cam Sả', 12000, 35000, 'Ly', 80, 0, 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80'],
        ['SP11', 'giaikhat', 'Cafe Muối Quy Nhơn', 10000, 28000, 'Ly', 80, 0, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80'],
        ['SP12', 'anvat', 'Đậu Phộng Rang Tỏi Ớt', 9000, 25000, 'Đĩa', 60, 0, 'https://images.unsplash.com/photo-1567892737950-30c4db37cd89?auto=format&fit=crop&w=900&q=80'],
      ];
      const addProduct = this.db.prepare(`INSERT INTO products(id,category_id,name,cost_price,selling_price,unit,stock_quantity,is_weighted,image_url) VALUES(?,?,?,?,?,?,?,?,?)`);
      for (const product of products) addProduct.run(...product);
    }
    const demoImages = {
      SP01: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80', SP02: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80',
      SP03: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?auto=format&fit=crop&w=900&q=80', SP04: 'https://images.unsplash.com/photo-1534482421-64566f976cfa?auto=format&fit=crop&w=900&q=80',
      SP05: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80', SP06: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=80',
      SP07: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80', SP08: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=900&q=80',
      SP09: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?auto=format&fit=crop&w=900&q=80', SP10: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80',
      SP11: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80', SP12: 'https://images.unsplash.com/photo-1567892737950-30c4db37cd89?auto=format&fit=crop&w=900&q=80',
    };
    const updateDemoImage = this.db.prepare("UPDATE products SET image_url=? WHERE id=? AND (image_url IS NULL OR image_url='')");
    for (const [id, image] of Object.entries(demoImages)) updateDemoImage.run(image, id);

    const settings = [
      ['store.name', 'NinoPOS Demo Restaurant'], ['store.address', '123 Nguyen Hue, Quy Nhon'],
      ['store.phone', '0256 123 456'], ['vat.default', '8'], ['payment.bank.bin', '970436'],
      ['payment.bank.account', '0123456789'], ['payment.bank.name', 'NINOTEK COFFEE'],
      ['printer.kind', 'WindowsSpooler'], ['printer.name', ''],
      ['printer.host', ''], ['printer.port', '9100'],
    ];
    const addSetting = this.db.prepare('INSERT OR IGNORE INTO system_settings(key,value) VALUES(?,?)');
    for (const setting of settings) addSetting.run(...setting);
  }

  static hashPassword(value) {
    return crypto.scryptSync(value, 'ninopos-local-salt', 32).toString('hex');
  }

  authenticate(username, password) {
    const user = this.db.prepare("SELECT id,username,password_hash,full_name,role,status FROM users WHERE username=? COLLATE NOCASE AND status='ACTIVE'").get(String(username || '').trim());
    const storedHash = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(0);
    const suppliedHash = Buffer.from(PosDatabase.hashPassword(String(password || '')), 'hex');
    const valid = storedHash.length === suppliedHash.length && crypto.timingSafeEqual(storedHash, suppliedHash);
    if (!user || !valid) throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
    delete user.password_hash;
    user.permissions = this.getUserPermissions(user.id, user.role);
    return user;
  }
  authenticatePin(pin, userId = null) {
    const value = String(pin || '').trim();
    if (!/^\d{4,6}$/.test(value)) throw new Error('PIN phải có 4-6 chữ số.');
    const user = userId
      ? this.db.prepare("SELECT id,username,full_name,role,status FROM users WHERE id=? AND pin_code=? AND status='ACTIVE'").get(userId, value)
      : this.db.prepare("SELECT id,username,full_name,role,status FROM users WHERE pin_code=? AND status='ACTIVE' ORDER BY created_at").get(value);
    if (!user) throw new Error('PIN không đúng.');
    user.permissions = this.getUserPermissions(user.id, user.role);
    return user;
  }
  defaultPermissions(role) { return { ...(PERMISSION_DEFAULTS[role] || PERMISSION_DEFAULTS.WAITER) }; }
  getUser(id) { const user = this.db.prepare("SELECT id,username,full_name,role,status FROM users WHERE id=? AND status='ACTIVE'").get(id); if (user) user.permissions = this.getUserPermissions(id, user.role); return user; }
  getUserPermissions(id, role = null) { const user = this.db.prepare('SELECT role,permissions_json FROM users WHERE id=?').get(id); const base = this.defaultPermissions(role || user?.role); if (!user?.permissions_json) return base; try { return { ...base, ...JSON.parse(user.permissions_json) }; } catch (_) { return base; } }
  listUsers() { return this.db.prepare('SELECT id,username,full_name,role,pin_code,status,created_at,permissions_json FROM users ORDER BY full_name').all().map((user) => ({ ...user, permissions: this.getUserPermissions(user.id, user.role), permissions_json: undefined })); }
  getPermissionCatalog() { return { groups: [{ id: 'table', label: 'Sơ đồ bàn & đặt bàn', items: [{ key: 'table.view', label: 'Xem trạng thái bàn' }, { key: 'table.open', label: 'Mở bàn / đổi trạng thái' }, { key: 'table.reserve', label: 'Nhận đặt cọc / giữ bàn' }, { key: 'table.manage', label: 'Thêm, xóa, đổi vị trí bàn' }] }, { id: 'order', label: 'Bán hàng & gọi món', items: [{ key: 'order.add', label: 'Tìm và thêm món' }, { key: 'order.note', label: 'Thêm ghi chú bếp' }, { key: 'order.kitchen', label: 'Báo bếp / bar' }, { key: 'order.delete_unprinted', label: 'Xóa món chưa gửi bếp' }, { key: 'order.cancel_printed', label: 'Hủy món đã gửi bếp' }, { key: 'order.move', label: 'Chuyển bàn' }, { key: 'order.merge', label: 'Gộp / tách đơn' }] }, { id: 'payment', label: 'Thanh toán & hóa đơn', items: [{ key: 'payment.draft', label: 'In phiếu tạm tính' }, { key: 'payment.discount', label: 'Chiết khấu / voucher' }, { key: 'payment.collect', label: 'Thu tiền' }, { key: 'payment.drawer', label: 'Mở két tiền' }, { key: 'payment.reprint', label: 'In lại hóa đơn' }, { key: 'payment.void', label: 'Hủy hóa đơn đã thanh toán' }] }, { id: 'shift', label: 'Quản lý ca', items: [{ key: 'shift.pin', label: 'Đăng nhập bằng PIN' }, { key: 'shift.open', label: 'Khai báo tiền đầu ca' }, { key: 'shift.close', label: 'Kết ca / bàn giao' }] }, { id: 'backoffice', label: 'Kho, báo cáo & cấu hình', items: [{ key: 'inventory.view_cost', label: 'Xem giá vốn' }, { key: 'inventory.manage', label: 'Quản lý thực đơn / tồn kho' }, { key: 'report.view', label: 'Xem báo cáo' }, { key: 'report.export', label: 'Xuất báo cáo Excel' }, { key: 'settings.manage', label: 'Cấu hình hệ thống' }] }] }; }
  createUser({ id = crypto.randomUUID(), username, password, full_name, role = 'WAITER', pin_code = null }) {
    if (!['ADMIN', 'CASHIER', 'WAITER'].includes(role)) throw new Error('Role không hợp lệ.');
    if (!username || !full_name || !password) throw new Error('Thiếu username, họ tên hoặc mật khẩu.');
    if (pin_code !== null && !/^\d{4,6}$/.test(String(pin_code))) throw new Error('PIN phải có 4-6 chữ số.');
    this.db.prepare('INSERT INTO users(id,username,password_hash,full_name,role,pin_code,permissions_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, username, PosDatabase.hashPassword(password), full_name, role, pin_code, JSON.stringify(this.defaultPermissions(role)), new Date().toISOString());
    return this.getUser(id);
  }
  updateUser(id, patch) {
    const user = this.getUser(id); if (!user) throw new Error('Không tìm thấy nhân viên.');
    if (patch.role && !['ADMIN', 'CASHIER', 'WAITER'].includes(patch.role)) throw new Error('Role không hợp lệ.');
    this.db.prepare('UPDATE users SET full_name=COALESCE(?,full_name),role=COALESCE(?,role),pin_code=COALESCE(?,pin_code),status=COALESCE(?,status),password_hash=COALESCE(?,password_hash) WHERE id=?')
      .run(patch.full_name || null, patch.role || null, patch.pin_code || null, patch.status || null, patch.password ? PosDatabase.hashPassword(patch.password) : null, id);
    if (patch.permissions) this.db.prepare('UPDATE users SET permissions_json=? WHERE id=?').run(JSON.stringify({ ...this.defaultPermissions(patch.role || user.role), ...patch.permissions }), id);
    return this.getUser(id);
  }
  updateOwnCredentials(id, currentPassword, nextPassword, nextPin) {
    const user = this.db.prepare("SELECT id,username,password_hash FROM users WHERE id=? AND status='ACTIVE'").get(id);
    if (!user || !PosDatabase.verifyPassword(currentPassword, user.password_hash)) throw new Error('Mật khẩu hiện tại không đúng.');
    if (!nextPassword && !nextPin) throw new Error('Hãy nhập mật khẩu mới hoặc mã PIN mới.');
    if (nextPassword && String(nextPassword).length < 6) throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    if (nextPin && !/^\d{4,6}$/.test(String(nextPin))) throw new Error('PIN mới phải có 4-6 chữ số.');
    if (nextPassword) this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(PosDatabase.hashPassword(nextPassword), id);
    if (nextPin) this.db.prepare('UPDATE users SET pin_code=? WHERE id=?').run(String(nextPin), id);
    return this.getUser(id);
  }
  updateUserPermissions(id, permissions) { const user = this.db.prepare('SELECT id,role FROM users WHERE id=?').get(id); if (!user) throw new Error('Không tìm thấy nhân viên.'); const allowed = this.defaultPermissions(user.role); const next = Object.fromEntries(Object.keys(allowed).map((key) => [key, Boolean(permissions[key])])); this.db.prepare('UPDATE users SET permissions_json=? WHERE id=?').run(JSON.stringify(next), id); return this.getUserPermissions(id, user.role); }
  userHasPermission(id, permission) { const user = this.db.prepare('SELECT role FROM users WHERE id=? AND status=\'ACTIVE\'').get(id); return Boolean(user && (user.role === 'ADMIN' || this.getUserPermissions(id, user.role)[permission])); }

  openShift(userId, initialCash) {
    const existing = this.db.prepare("SELECT * FROM shifts WHERE user_id=? AND status='OPEN'").get(userId);
    if (existing) return existing;
    if (!Number.isFinite(Number(initialCash)) || Number(initialCash) < 0) throw new Error('Tiền đầu ca không hợp lệ.');
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO shifts(id,user_id,start_time,initial_cash,status) VALUES(?,?,?,? ,\'OPEN\')').run(id, userId, new Date().toISOString(), Number(initialCash));
    return this.db.prepare('SELECT * FROM shifts WHERE id=?').get(id);
  }
  getOpenShift(userId) { return this.db.prepare("SELECT * FROM shifts WHERE user_id=? AND status='OPEN'").get(userId); }
  closeShift(userId, closingCash) {
    const shift = this.getOpenShift(userId);
    if (!shift) throw new Error('Không có ca đang mở.');
    if (!Number.isFinite(Number(closingCash)) || Number(closingCash) < 0) throw new Error('Tiền kiểm đếm không hợp lệ.');
    const summary = this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN payment_method LIKE 'CASH%' THEN grand_total ELSE 0 END),0) AS cash,
      COALESCE(SUM(CASE WHEN payment_method LIKE 'VIETQR%' THEN grand_total ELSE 0 END),0) AS qr,
      COALESCE(SUM(CASE WHEN payment_method LIKE 'CARD%' THEN grand_total ELSE 0 END),0) AS card
      FROM orders WHERE status='PAID' AND check_out_time>=?`).get(shift.start_time);
    const expected = Number(shift.initial_cash) + Number(summary.cash);
    this.db.prepare("UPDATE shifts SET end_time=?,closing_cash=?,total_cash_sales=?,total_qr_sales=?,total_card_sales=?,status='CLOSED' WHERE id=?")
      .run(new Date().toISOString(), Number(closingCash), summary.cash, summary.qr, summary.card, shift.id);
    return { ...this.db.prepare('SELECT * FROM shifts WHERE id=?').get(shift.id), expected_cash: expected, difference: Number(closingCash) - expected };
  }
  shiftReport(shiftId) {
    const shift = this.db.prepare('SELECT * FROM shifts WHERE id=?').get(shiftId);
    if (!shift) throw new Error('Không tìm thấy ca.');
    const orders = this.db.prepare("SELECT id,grand_total,payment_method,check_out_time,status FROM orders WHERE status='PAID' AND check_out_time>=? AND (? IS NULL OR check_out_time<=?) ORDER BY check_out_time").all(shift.start_time, shift.end_time, shift.end_time);
    return { shift, orders, totals: { cash: shift.total_cash_sales, qr: shift.total_qr_sales, card: shift.total_card_sales } };
  }
  analyticsReport(from, to) {
    const start = `${from}T00:00:00.000Z`; const end = `${to}T23:59:59.999Z`;
    const orders = this.db.prepare(`SELECT o.id,o.check_in_time,o.check_out_time,o.grand_total,o.payment_method,o.status,t.name AS table_name,u.full_name AS cashier_name FROM orders o LEFT JOIN tables_pos t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.user_id WHERE o.status='PAID' AND o.check_out_time BETWEEN ? AND ? ORDER BY o.check_out_time DESC`).all(start, end);
    const totals = this.db.prepare(`SELECT COALESCE(SUM(grand_total),0) revenue,COUNT(*) invoices,COALESCE(AVG(grand_total),0) average FROM orders WHERE status='PAID' AND check_out_time BETWEEN ? AND ?`).get(start, end);
    const payments = this.db.prepare(`SELECT CASE WHEN payment_method LIKE 'CASH%' THEN 'CASH' WHEN payment_method LIKE 'VIETQR%' THEN 'VIETQR' WHEN payment_method LIKE 'CARD%' THEN 'CARD' ELSE 'OTHER' END method,COALESCE(SUM(grand_total),0) total,COUNT(*) count FROM orders WHERE status='PAID' AND check_out_time BETWEEN ? AND ? GROUP BY method`).all(start, end);
    const topProduct = this.db.prepare(`SELECT d.product_name,SUM(d.quantity) quantity FROM order_details d JOIN orders o ON o.id=d.order_id WHERE o.status='PAID' AND o.check_out_time BETWEEN ? AND ? GROUP BY d.product_id,d.product_name ORDER BY quantity DESC LIMIT 1`).get(start, end);
    const daily = this.db.prepare(`SELECT substr(check_out_time,1,10) day,COALESCE(SUM(grand_total),0) total,COUNT(*) count FROM orders WHERE status='PAID' AND check_out_time BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(start, end);
    return { from, to, totals, payments, topProduct: topProduct || null, daily, orders };
  }

  getTables() { return this.db.prepare(`SELECT t.*, a.name AS area_name, o.check_in_time, o.grand_total AS active_order_total FROM tables_pos t JOIN areas a ON a.id=t.area_id LEFT JOIN orders o ON o.id=t.active_order_id AND o.status='SERVING' ORDER BY a.sort_order,t.name`).all(); }
  getAreas() { return this.db.prepare('SELECT * FROM areas ORDER BY sort_order').all(); }
  createArea({ id = crypto.randomUUID(), name, sort_order = 0 }) {
    if (!String(name || '').trim()) throw new Error('Tên khu vực không được để trống.');
    this.db.prepare('INSERT INTO areas(id,name,sort_order) VALUES(?,?,?)').run(id, name.trim(), Number(sort_order) || 0);
    return this.db.prepare('SELECT * FROM areas WHERE id=?').get(id);
  }
  updateArea(id, patch) {
    const area = this.db.prepare('SELECT * FROM areas WHERE id=?').get(id);
    if (!area) throw new Error('Không tìm thấy khu vực.');
    this.db.prepare('UPDATE areas SET name=COALESCE(?,name),sort_order=COALESCE(?,sort_order) WHERE id=?')
      .run(patch.name ? String(patch.name).trim() : null, patch.sort_order === undefined ? null : Number(patch.sort_order), id);
    return this.db.prepare('SELECT * FROM areas WHERE id=?').get(id);
  }
  deleteArea(id) {
    const transaction = this.db.transaction(() => {
      const occupied = this.db.prepare("SELECT name FROM tables_pos WHERE area_id=? AND status!='EMPTY' LIMIT 1").get(id);
      if (occupied) throw new Error(`Không thể xóa khu vực vì bàn ${occupied.name} đang có khách hoặc đơn mở.`);
      const tables = this.db.prepare('SELECT id FROM tables_pos WHERE area_id=?').all(id);
      if (!tables.length) return false;
      const placeholders = tables.map(() => '?').join(',');
      this.db.prepare(`UPDATE orders SET table_id=NULL WHERE table_id IN (${placeholders})`).run(...tables.map((table) => table.id));
      this.db.prepare('DELETE FROM tables_pos WHERE area_id=?').run(id);
      return this.db.prepare('DELETE FROM areas WHERE id=?').run(id).changes > 0;
    });
    return transaction();
  }
  createTable({ id = crypto.randomUUID(), area_id, name, current_guest_count = 0 }) {
    if (!this.db.prepare('SELECT 1 FROM areas WHERE id=?').get(area_id)) throw new Error('Khu vực không tồn tại.');
    if (!String(name || '').trim()) throw new Error('Tên bàn không được để trống.');
    this.db.prepare('INSERT INTO tables_pos(id,area_id,name,status,current_guest_count) VALUES(?,?,?,\'EMPTY\',?)').run(id, area_id, name.trim(), Number(current_guest_count) || 0);
    return this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(id);
  }
  updateTable(id, patch) {
    const table = this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(id);
    if (!table) throw new Error('Không tìm thấy bàn.');
    if (patch.status && !['EMPTY', 'OCCUPIED', 'WAITING_PAYMENT', 'RESERVED'].includes(patch.status)) throw new Error('Trạng thái bàn không hợp lệ.');
    this.db.prepare('UPDATE tables_pos SET name=COALESCE(?,name),area_id=COALESCE(?,area_id),status=COALESCE(?,status),current_guest_count=COALESCE(?,current_guest_count) WHERE id=?')
      .run(patch.name || null, patch.area_id || null, patch.status || null, patch.current_guest_count === undefined ? null : Number(patch.current_guest_count), id);
    return this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(id);
  }
  deleteTable(id) {
    const table = this.db.prepare('SELECT status FROM tables_pos WHERE id=?').get(id);
    if (!table) throw new Error('Không tìm thấy bàn.');
    if (table.status !== 'EMPTY') throw new Error('Chỉ xóa được bàn đang trống.');
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE orders SET table_id=NULL WHERE table_id=?').run(id);
      return this.db.prepare('DELETE FROM tables_pos WHERE id=?').run(id).changes > 0;
    });
    return transaction();
  }
  getCategories() { return this.db.prepare('SELECT * FROM categories ORDER BY sort_order').all(); }
  getProducts(query = '', category = 'all') {
    return this.db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='ACTIVE' AND (?='' OR p.name LIKE ? OR p.id LIKE ?) AND (?='all' OR p.category_id=?) ORDER BY p.name`)
      .all(query, `%${query}%`, `%${query}%`, category, category);
  }
  getLowStockProducts() { return this.db.prepare("SELECT p.*,c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='ACTIVE' AND p.stock_quantity<=p.min_stock_quantity ORDER BY p.stock_quantity").all(); }
  getStockTransactions(productId = null) { return productId ? this.db.prepare('SELECT * FROM stock_transactions WHERE product_id=? ORDER BY created_at DESC').all(productId) : this.db.prepare('SELECT * FROM stock_transactions ORDER BY created_at DESC').all(); }
  getAllProductsForExport() {
    return this.db.prepare(`SELECT p.id, p.name, p.category_id, c.name AS category_name,
      p.cost_price, p.selling_price, p.unit, p.stock_quantity, p.is_weighted, p.status
      FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id`).all();
  }
  createProduct(product) {
    const data = this.normalizeProduct(product);
    this.db.prepare('INSERT INTO products(id,category_id,name,cost_price,selling_price,unit,stock_quantity,is_weighted,image_url,min_stock_quantity,status) VALUES(@id,@category_id,@name,@cost_price,@selling_price,@unit,@stock_quantity,@is_weighted,@image_url,@min_stock_quantity,@status)').run(data);
    return this.db.prepare('SELECT * FROM products WHERE id=?').get(data.id);
  }
  updateProduct(id, patch) {
    const current = this.db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!current) throw new Error('Không tìm thấy mặt hàng.');
    const data = this.normalizeProduct({ ...current, ...patch, id });
    this.db.prepare('UPDATE products SET category_id=?,name=?,cost_price=?,selling_price=?,unit=?,stock_quantity=?,is_weighted=?,image_url=?,min_stock_quantity=?,status=? WHERE id=?')
      .run(data.category_id, data.name, data.cost_price, data.selling_price, data.unit, data.stock_quantity, data.is_weighted, data.image_url, data.min_stock_quantity, data.status, id);
    return this.db.prepare('SELECT * FROM products WHERE id=?').get(id);
  }
  deleteProduct(id) {
    if (this.db.prepare('SELECT 1 FROM order_details WHERE product_id=? LIMIT 1').get(id)) {
      this.db.prepare("UPDATE products SET status='INACTIVE' WHERE id=?").run(id);
      return true;
    }
    return this.db.prepare('DELETE FROM products WHERE id=?').run(id).changes > 0;
  }
  normalizeProduct(product) {
    const data = { id: String(product.id || crypto.randomUUID()).trim(), name: String(product.name || '').trim(), category_id: String(product.category_id || '').trim(), cost_price: Number(product.cost_price || 0), selling_price: Number(product.selling_price || 0), unit: String(product.unit || 'Phần').trim(), stock_quantity: Number(product.stock_quantity || 0), min_stock_quantity: Number(product.min_stock_quantity ?? 5), is_weighted: Number(product.is_weighted) ? 1 : 0, image_url: String(product.image_url || '').trim() || null, status: String(product.status || 'ACTIVE').toUpperCase() };
    if (!data.name || !data.category_id) throw new Error('Món phải có tên và danh mục.');
    if (![data.cost_price, data.selling_price, data.stock_quantity, data.min_stock_quantity].every(Number.isFinite) || data.cost_price < 0 || data.selling_price < 0 || data.stock_quantity < 0 || data.min_stock_quantity < 0) throw new Error('Giá, tồn kho hoặc mức cảnh báo không hợp lệ.');
    if (!['ACTIVE', 'INACTIVE'].includes(data.status)) throw new Error('Trạng thái món không hợp lệ.');
    return data;
  }
  importProducts(rows) {
    const required = ['id', 'name', 'category_id', 'category_name', 'cost_price', 'selling_price', 'unit', 'stock_quantity', 'is_weighted', 'status'];
    const transaction = this.db.transaction(() => {
      const upsertCategory = this.db.prepare(`INSERT INTO categories(id,name,icon,sort_order) VALUES(@category_id,@category_name,'fa-utensils',999)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name`);
      const upsertProduct = this.db.prepare(`INSERT INTO products(id,category_id,name,cost_price,selling_price,unit,stock_quantity,is_weighted,status)
        VALUES(@id,@category_id,@name,@cost_price,@selling_price,@unit,@stock_quantity,@is_weighted,@status)
        ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,name=excluded.name,cost_price=excluded.cost_price,
        selling_price=excluded.selling_price,unit=excluded.unit,stock_quantity=excluded.stock_quantity,
        is_weighted=excluded.is_weighted,status=excluded.status`);
      let imported = 0;
      for (const row of rows) {
        const missing = required.filter((key) => row[key] === undefined || row[key] === null || String(row[key]).trim() === '');
        if (missing.length) throw new Error(`Dòng ${imported + 2} thiếu: ${missing.join(', ')}`);
        const normalized = {
          id: String(row.id).trim(), name: String(row.name).trim(), category_id: String(row.category_id).trim(),
          category_name: String(row.category_name).trim(), cost_price: Number(row.cost_price),
          selling_price: Number(row.selling_price), unit: String(row.unit).trim(), stock_quantity: Number(row.stock_quantity),
          is_weighted: Number(row.is_weighted) ? 1 : 0, status: String(row.status).trim().toUpperCase(),
        };
        if (!Number.isFinite(normalized.cost_price) || !Number.isFinite(normalized.selling_price) || !Number.isFinite(normalized.stock_quantity)) {
          throw new Error(`Dòng ${imported + 2} có giá hoặc tồn kho không hợp lệ.`);
        }
        if (!['ACTIVE', 'INACTIVE'].includes(normalized.status)) throw new Error(`Dòng ${imported + 2}: status phải là ACTIVE hoặc INACTIVE.`);
        upsertCategory.run(normalized); upsertProduct.run(normalized); imported++;
      }
      return imported;
    });
    return transaction();
  }
  getSettings() { return Object.fromEntries(this.db.prepare('SELECT key,value FROM system_settings').all().map((row) => [row.key, row.value])); }
  setSetting(key, value) { this.db.prepare('INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); }
  listPromotions() { return this.db.prepare('SELECT * FROM promotions ORDER BY starts_at DESC').all(); }
  createPromotion({ id = crypto.randomUUID(), name, discount_type = 'PERCENT', discount_value = 0, starts_at, ends_at }) { if (!String(name || '').trim() || !starts_at || !ends_at) throw new Error('Thiếu tên hoặc thời gian chương trình.'); if (!['PERCENT', 'AMOUNT'].includes(discount_type)) throw new Error('Loại giảm giá không hợp lệ.'); if (new Date(starts_at) >= new Date(ends_at)) throw new Error('Thời gian khuyến mãi không hợp lệ.'); this.db.prepare('INSERT INTO promotions(id,name,discount_type,discount_value,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, name.trim(), discount_type, Number(discount_value), starts_at, ends_at, new Date().toISOString()); return this.db.prepare('SELECT * FROM promotions WHERE id=?').get(id); }
  deletePromotion(id) { return this.db.prepare('DELETE FROM promotions WHERE id=?').run(id).changes > 0; }

  openOrder(tableId, userId) {
    if (!userId) throw new Error('Thiếu nhân viên tạo đơn.');
    const transaction = this.db.transaction(() => {
      if (tableId) {
        const table = this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(tableId);
        if (!table) throw new Error('Không tìm thấy bàn.');
        const existing = this.db.prepare("SELECT * FROM orders WHERE table_id=? AND status='SERVING'").get(tableId);
        if (existing) return this.getOrder(existing.id);
        if (table.status !== 'EMPTY') throw new Error('Bàn không sẵn sàng để mở đơn.');
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO orders(id,table_id,user_id,check_in_time,vat_rate,status) VALUES(?,?,?,?,8,'SERVING')`).run(id, tableId || null, userId, now);
      if (tableId) this.db.prepare("UPDATE tables_pos SET status='OCCUPIED',active_order_id=? WHERE id=?").run(id, tableId);
      return this.getOrder(id);
    });
    return transaction();
  }

  getOrder(orderId) {
    const order = this.db.prepare('SELECT o.*, t.name AS table_name FROM orders o LEFT JOIN tables_pos t ON t.id=o.table_id WHERE o.id=?').get(orderId);
    if (!order) return null;
    order.details = this.db.prepare('SELECT * FROM order_details WHERE order_id=? ORDER BY rowid').all(orderId);
    return order;
  }
  getOpenOrders() { return this.db.prepare("SELECT o.*,t.name AS table_name FROM orders o LEFT JOIN tables_pos t ON t.id=o.table_id WHERE o.status='SERVING' ORDER BY o.check_in_time").all(); }

  addOrderItem(orderId, productId, quantity = 1, note = '') {
    const order = this.db.prepare("SELECT id FROM orders WHERE id=? AND status='SERVING'").get(orderId);
    if (!order) throw new Error('Đơn đang phục vụ không tồn tại.');
    quantity = Number(quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Số lượng món không hợp lệ.');
    note = String(note || '').trim();
    const product = this.db.prepare("SELECT * FROM products WHERE id=? AND status='ACTIVE'").get(productId);
    if (!product) throw new Error('Không tìm thấy món hoặc món đã ngừng bán.');
    const detail = this.db.prepare('SELECT * FROM order_details WHERE order_id=? AND product_id=? AND note=? AND is_printed_kitchen=0').get(orderId, productId, note);
    if (detail) this.db.prepare('UPDATE order_details SET quantity=quantity+?, amount=amount+? WHERE id=?').run(quantity, product.selling_price * quantity, detail.id);
    else this.db.prepare('INSERT INTO order_details(id,order_id,product_id,product_name,quantity,price,amount,note) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), orderId, product.id, product.name, quantity, product.selling_price, product.selling_price * quantity, note);
    this.recalculate(orderId);
    return this.getOrder(orderId);
  }

  updateDetail(detailId, quantity) {
    const detail = this.db.prepare('SELECT * FROM order_details WHERE id=?').get(detailId);
    if (!detail) throw new Error('Không tìm thấy món trong đơn.');
    quantity = Number(quantity);
    if (!Number.isFinite(quantity)) throw new Error('Số lượng món không hợp lệ.');
    if (detail.is_printed_kitchen) throw new Error('Món đã gửi bếp, cần quyền Admin để sửa.');
    if (quantity <= 0) this.db.prepare('DELETE FROM order_details WHERE id=?').run(detailId);
    else this.db.prepare('UPDATE order_details SET quantity=?, amount=price*? WHERE id=?').run(quantity, quantity, detailId);
    this.recalculate(detail.order_id);
    return this.getOrder(detail.order_id);
  }
  cancelPrintedDetail(detailId, userId) {
    const transaction = this.db.transaction(() => {
      const detail = this.db.prepare('SELECT * FROM order_details WHERE id=?').get(detailId);
      if (!detail) throw new Error('Không tìm thấy món trong đơn.');
      if (!detail.is_printed_kitchen) throw new Error('Món chưa gửi bếp, hãy dùng nút giảm/xóa món.');
      this.db.prepare('DELETE FROM order_details WHERE id=?').run(detailId);
      this.recalculate(detail.order_id);
      this.audit(userId, 'CANCEL_PRINTED_ITEM', 'order_details', detailId, detail, { cancelled: true });
      return this.getOrder(detail.order_id);
    });
    return transaction();
  }

  recalculate(orderId) {
    const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    const subtotal = this.db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM order_details WHERE order_id=?').get(orderId).total;
    const discount = order.discount_type === 'PERCENT' ? subtotal * (order.discount_val / 100) : order.discount_val;
    const vat = (subtotal - discount) * ((order.vat_rate || 0) / 100);
    this.db.prepare('UPDATE orders SET subtotal=?,vat_amount=?,grand_total=? WHERE id=?').run(subtotal, vat, subtotal - discount + vat, orderId);
  }
  createVietQr(orderId) {
    const order = this.getOrder(orderId);
    if (!order || order.status !== 'SERVING') throw new Error('Đơn chưa sẵn sàng tạo VietQR.');
    const settings = this.getSettings();
    const acqId = settings['payment.bank.bin']; const account = settings['payment.bank.account'];
    if (!/^\d{6}$/.test(acqId || '') || !/^\d{1,19}$/.test(account || '')) throw new Error('Cấu hình BIN hoặc số tài khoản VietQR không hợp lệ.');
    const purpose = sanitizeQrText(`${order.id}${order.table_name ? ` BAN ${order.table_name}` : ''}`).slice(0, 95);
    const merchant = sanitizeQrText(settings['payment.bank.name'] || settings['store.name'] || 'NINOPOS').slice(0, 25);
    const accountInfo = tlv('00', 'A000000727') + tlv('01', account) + tlv('02', 'QRIBFTTA');
    const payload = tlv('00', '01') + tlv('01', '12') + tlv('38', tlv('00', accountInfo)) + tlv('53', '704') + tlv('54', String(Math.round(order.grand_total))) + tlv('58', 'VN') + tlv('59', merchant) + tlv('62', tlv('08', purpose)) + '6304';
    return `${payload}${crc16(payload)}`;
  }
  printTemporary(orderId) { const order = this.getOrder(orderId); if (!order) throw new Error('Không tìm thấy đơn.'); if (order.table_id) this.db.prepare("UPDATE tables_pos SET status='WAITING_PAYMENT' WHERE active_order_id=?").run(orderId); this.printJob('DRAFT_BILL', JSON.stringify(order)); return order; }

  sendToKitchen(orderId) {
    const order = this.db.prepare("SELECT id FROM orders WHERE id=? AND status='SERVING'").get(orderId);
    if (!order) throw new Error('Đơn đang phục vụ không tồn tại.');
    this.db.prepare('UPDATE order_details SET is_printed_kitchen=1 WHERE order_id=?').run(orderId);
    this.printJob('KITCHEN_TICKET', JSON.stringify(this.getOrder(orderId)));
    return this.getOrder(orderId);
  }

  cancelOrder(orderId, userId = null) {
    const transaction = this.db.transaction(() => {
      const order = this.db.prepare("SELECT * FROM orders WHERE id=? AND status='SERVING'").get(orderId);
      if (!order) throw new Error('Đơn đang phục vụ không tồn tại.');
      this.db.prepare("UPDATE orders SET status='CANCELLED',check_out_time=?,note=? WHERE id=?")
        .run(new Date().toISOString(), 'Cancelled by user', orderId);
      if (order.table_id) this.db.prepare("UPDATE tables_pos SET status='EMPTY',active_order_id=NULL,current_guest_count=0 WHERE id=?").run(order.table_id);
      this.audit(userId, 'CANCEL_ORDER', 'orders', orderId, { status: order.status, tableId: order.table_id }, { status: 'CANCELLED' });
      return this.getOrder(orderId);
    });
    return transaction();
  }

  checkout(orderId, method, paid = 0, trace = '') {
    const transaction = this.db.transaction(() => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
      if (!order || order.status !== 'SERVING') throw new Error('Đơn không sẵn sàng thanh toán.');
      if (method === 'CASH' && paid < order.grand_total) throw new Error('Tiền khách đưa chưa đủ.');
      const change = method === 'CASH' ? paid - order.grand_total : 0;
      const details = this.db.prepare('SELECT d.*,p.stock_quantity,p.is_weighted FROM order_details d JOIN products p ON p.id=d.product_id WHERE d.order_id=?').all(orderId);
      for (const detail of details) if (Number(detail.stock_quantity) < Number(detail.quantity)) throw new Error(`Tồn kho không đủ: ${detail.product_name}`);
      for (const detail of details) {
        const after = Number(detail.stock_quantity) - Number(detail.quantity);
        this.db.prepare('UPDATE products SET stock_quantity=? WHERE id=?').run(after, detail.product_id);
        this.db.prepare('INSERT INTO stock_transactions(id,product_id,order_id,user_id,transaction_type,quantity_change,quantity_after,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(crypto.randomUUID(), detail.product_id, orderId, order.user_id, 'SALE', -Number(detail.quantity), after, method, new Date().toISOString());
      }
      this.db.prepare("UPDATE orders SET status='PAID',check_out_time=?,payment_method=?,customer_paid=?,change_amount=? WHERE id=?").run(new Date().toISOString(), `${method}${trace ? `:${trace}` : ''}`, paid, change, orderId);
      if (order.table_id) this.db.prepare("UPDATE tables_pos SET status='EMPTY',active_order_id=NULL,current_guest_count=0 WHERE id=?").run(order.table_id);
      const printedOrder = this.getOrder(orderId);
      if (method === 'VIETQR') printedOrder.qrPayload = this.createVietQr(orderId);
      this.printJob('BILL', JSON.stringify(printedOrder));
      if (method === 'CASH') this.printJob('DRAWER_OPEN', JSON.stringify({ command: [0x1b, 0x70, 0x00, 0x19, 0xfa] }));
      return this.getOrder(orderId);
    });
    return transaction();
  }

  moveTable(orderId, targetTableId, userId = null) {
    const transaction = this.db.transaction(() => {
      const target = this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(targetTableId);
      const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
      if (!order || order.status !== 'SERVING') throw new Error('Đơn đang phục vụ không tồn tại.');
      const source = order.table_id ? this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(order.table_id) : null;
      if (!source || !target || target.status !== 'EMPTY') throw new Error('Bàn đích phải đang trống.');
      this.db.prepare('UPDATE tables_pos SET status=\'EMPTY\',active_order_id=NULL WHERE active_order_id=?').run(orderId);
      this.db.prepare("UPDATE tables_pos SET status='OCCUPIED',active_order_id=? WHERE id=?").run(orderId, targetTableId);
      this.db.prepare('UPDATE orders SET table_id=? WHERE id=?').run(targetTableId, orderId);
      this.audit(userId, 'MOVE_TABLE', 'orders', orderId, { fromTableId: source.id, fromTable: source.name }, { toTableId: target.id, toTable: target.name });
      return this.getOrder(orderId);
    });
    return transaction();
  }
  mergeTables(sourceOrderId, targetOrderId, userId = null) {
    const transaction = this.db.transaction(() => {
      const source = this.db.prepare('SELECT * FROM orders WHERE id=? AND status=\'SERVING\'').get(sourceOrderId);
      const target = this.db.prepare('SELECT * FROM orders WHERE id=? AND status=\'SERVING\'').get(targetOrderId);
      if (!source || !target || source.id === target.id) throw new Error('Hai đơn đang phục vụ không hợp lệ để gộp.');
      const sourceTable = source.table_id ? this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(source.table_id) : null;
      const targetTable = target.table_id ? this.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(target.table_id) : null;
      if (!sourceTable || !targetTable || sourceTable.status !== 'OCCUPIED' || targetTable.status !== 'OCCUPIED') throw new Error('Cả hai bàn phải đang có khách để gộp.');
      const details = this.db.prepare('SELECT * FROM order_details WHERE order_id=?').all(sourceOrderId);
      for (const detail of details) {
        const same = this.db.prepare('SELECT * FROM order_details WHERE order_id=? AND product_id=? AND note=? AND is_printed_kitchen=0').get(targetOrderId, detail.product_id, detail.note || '');
        if (same) this.db.prepare('UPDATE order_details SET quantity=quantity+?,amount=amount+? WHERE id=?').run(detail.quantity, detail.amount, same.id);
        else this.db.prepare('UPDATE order_details SET order_id=? WHERE id=?').run(targetOrderId, detail.id);
      }
      this.recalculate(targetOrderId);
      this.db.prepare("UPDATE orders SET status='CANCELLED',note='Merged into order' WHERE id=?").run(sourceOrderId);
      if (source.table_id) this.db.prepare("UPDATE tables_pos SET status='EMPTY',active_order_id=NULL WHERE id=?").run(source.table_id);
      this.audit(userId, 'MERGE_TABLES', 'orders', targetOrderId, { sourceOrderId, sourceTableId: sourceTable.id, sourceTable: sourceTable.name }, { targetOrderId, targetTableId: targetTable.id, targetTable: targetTable.name });
      return this.getOrder(targetOrderId);
    });
    return transaction();
  }

  printJob(type, payload) {
    this.db.prepare('INSERT INTO print_jobs(job_type,printer,payload,created_at) VALUES(?,?,?,?)').run(type, this.getSettings()['printer.name'] || '', payload, new Date().toISOString());
  }
  audit(userId, action, entityType, entityId, oldValue, newValue) {
    this.db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), userId, action, entityType, entityId, JSON.stringify(oldValue), JSON.stringify(newValue), new Date().toISOString());
  }
  getAuditLogs(entityId = null) {
    return entityId ? this.db.prepare('SELECT * FROM audit_logs WHERE entity_id=? ORDER BY created_at DESC').all(entityId) : this.db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC').all();
  }
  getPrintJobs(status = 'PENDING') { return this.db.prepare('SELECT * FROM print_jobs WHERE status=? ORDER BY id').all(status); }
  markPrintJob(id, status, error = null) {
    if (!['PENDING', 'PRINTING', 'DONE', 'FAILED'].includes(status)) throw new Error('Trạng thái print job không hợp lệ.');
    this.db.prepare('UPDATE print_jobs SET status=?,retry_count=CASE WHEN ?=\'FAILED\' THEN retry_count+1 ELSE retry_count END,last_error=? WHERE id=?').run(status, status, error, id);
    return this.db.prepare('SELECT * FROM print_jobs WHERE id=?').get(id);
  }

  close() { this.db.close(); }
}

module.exports = { PosDatabase };
