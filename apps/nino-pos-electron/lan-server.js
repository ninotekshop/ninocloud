const http = require('http');
const url = require('url');
const crypto = require('crypto');

class LanServer {
  constructor(db, port = 8080) {
    this.db = db;
    this.port = port;
    this.pairedDevices = new Map();
    this.tableLocks = new Map();
    this.pairingCode = '123456';
    this.tableSockets = new Set();
    this.kitchenSockets = new Set();
    this.running = false;
    this.lastError = null;

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.initWebSocket();
  }

  setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-None-Match');
  }

  handleRequest(req, res) {
    this.setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    let bodyRaw = '';
    req.on('data', (chunk) => { bodyRaw += chunk; });
    req.on('end', () => {
      let body = {};
      if (bodyRaw) {
        try { body = JSON.parse(bodyRaw); } catch (_) {}
      }

      this.route(req, res, method, pathname, parsedUrl.query, body);
    });
  }

  route(req, res, method, pathname, query, body) {
    const sendJson = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    // Health / Ping check
    if (pathname === '/health' || pathname === '/') {
      return sendJson(200, { status: 'OK', message: 'NinoPOS LAN API Online' });
    }

    // 1. Discovery
    if (method === 'GET' && pathname === '/api/v1/lan/discovery') {
      const settings = this.db ? this.db.getSettings() : {};
      return sendJson(200, {
        storeName: settings['store.name'] || 'Ninotek Coffee',
        storeCode: settings['store.code'] || 'QN01',
        posVersion: '2.4.0',
        protocolVersion: 1,
        requiresPairing: true,
      });
    }

    // 2. Device Pairing
    if (method === 'POST' && pathname === '/api/v1/lan/devices/pair') {
      const { deviceName, deviceType, pairingCode } = body || {};
      if (pairingCode !== this.pairingCode) {
        return sendJson(403, { title: 'Mã ghép nối không chính xác. Mặc định là 123456.' });
      }
      const deviceId = 'dev-' + Date.now();
      const deviceToken = 'token-' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      this.pairedDevices.set(deviceToken, { deviceId, deviceName, deviceType });
      return sendJson(200, { deviceId, deviceToken });
    }

    // 3. Table Status
    if (method === 'GET' && pathname === '/api/v1/lan/tables/status') {
      try {
        const rawTables = this.db.getTables();
        const now = new Date();
        const result = rawTables.map((t) => {
          const lock = this.tableLocks.get(t.id);
          const isLocked = lock && lock.until > now;
          let seatedMin = null;
          if (t.check_in_time) {
            seatedMin = Math.floor((now - new Date(t.check_in_time)) / 60000);
          }
          return {
            id: t.id,
            name: t.name,
            areaId: t.area_id,
            areaName: t.area_name,
            seatCapacity: t.seat_capacity || 4,
            status: t.status || 'EMPTY',
            currentOrderId: t.active_order_id || null,
            guestCount: t.current_guest_count || 0,
            runningTotal: t.active_order_total || 0,
            seatedMinutes: seatedMin,
            lockedByUserId: isLocked ? lock.userId : null,
            lockedUntil: isLocked ? lock.until.toISOString() : null,
            rowVersion: t.row_version || 1,
          };
        });
        return sendJson(200, result);
      } catch (err) {
        return sendJson(500, { title: err.message });
      }
    }

    // 4. Lock Table
    const lockMatch = pathname.match(/^\/api\/v1\/lan\/tables\/([^\/]+)\/lock$/);
    if (method === 'POST' && lockMatch) {
      const tableId = lockMatch[1];
      const { userId, userName } = body || {};
      const until = new Date(Date.now() + 30000);
      this.tableLocks.set(tableId, { userId: userId || 'waiter', userName: userName || 'Waiter', until });
      this.broadcastTableEvent('TABLE_LOCKED', { tableId, lockedUntil: until.toISOString() });
      return sendJson(200, { lockedUntil: until.toISOString() });
    }

    // 5. Menu Snapshot
    if (method === 'GET' && pathname === '/api/v1/lan/menu') {
      try {
        const categories = this.db.getCategories().map((c) => ({
          id: c.id,
          name: c.name,
          colorCode: c.color_code || '#007AFF',
          sortOrder: c.sort_order || 0,
        }));
        const products = this.db.getProducts().map((p) => ({
          id: p.id,
          categoryId: p.category_id,
          name: p.name,
          basePrice: p.selling_price ?? p.price ?? 35000,
          unit: p.unit || 'Ly',
          isAvailable: p.status !== 'OUT_OF_STOCK',
          imageUrl: p.image_url || null,
          allowedToppingIds: ['top-1', 'top-2', 'top-3', 'top-4', 'top-5', 'top-6', 'top-7'],
        }));
        return sendJson(200, {
          etag: 'v1-' + Date.now(),
          categories,
          items: products,
          toppings: [
            { id: 'top-1', name: 'Trân châu đen', extraPrice: 5000, groupName: 'TOPPING' },
            { id: 'top-2', name: 'Thạch trái cây', extraPrice: 5000, groupName: 'TOPPING' },
            { id: 'top-3', name: 'Kem cheese', extraPrice: 10000, groupName: 'TOPPING' },
            { id: 'top-4', name: 'Ít đường (50%)', extraPrice: 0, groupName: 'SUGAR' },
            { id: 'top-5', name: 'Không đường (0%)', extraPrice: 0, groupName: 'SUGAR' },
            { id: 'top-6', name: 'Ít đá (50%)', extraPrice: 0, groupName: 'ICE' },
            { id: 'top-7', name: 'Không đá (0%)', extraPrice: 0, groupName: 'ICE' },
          ],
        });
      } catch (err) {
        return sendJson(500, { title: err.message });
      }
    }

    // 6. Create Order from Tablet
    if (method === 'POST' && pathname === '/api/v1/lan/order/create') {
      try {
        const { orderId, userId, tableId, orderType, guestCount, items } = body || {};
        if (!orderId || !items || !items.length) {
          return sendJson(400, { title: 'Thiếu thông tin order' });
        }

        const existing = this.db.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
        if (existing) {
          return sendJson(200, { id: existing.id, orderCode: existing.id, status: existing.status });
        }

        let subtotal = 0;
        const foodItems = [];
        const drinkItems = [];

        items.forEach((item) => {
          const product = this.db.db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(item.itemId);
          const price = product ? (product.selling_price ?? product.price ?? 35000) : 35000;
          const lineTotal = price * (item.quantity || 1);
          subtotal += lineTotal;
          const detailObj = {
            id: item.orderDetailId || ('det-' + Math.random().toString(36).substring(2)),
            product_id: item.itemId,
            product_name: product ? product.name : 'Món',
            quantity: item.quantity || 1,
            price,
            amount: lineTotal,
            note: item.note || null,
            category_id: product ? product.category_id : null,
            category_name: product ? product.category_name : null,
            kitchenStatus: 'WAITING',
          };

          if (this.db.isDrinkItem && this.db.isDrinkItem(detailObj)) {
            drinkItems.push(detailObj);
          } else {
            foodItems.push(detailObj);
          }
        });

        const nowIso = new Date().toISOString();
        this.db.db.prepare(`
          INSERT INTO orders (id, table_id, user_id, check_in_time, subtotal, vat_amount, grand_total, payment_method, status)
          VALUES (?, ?, ?, ?, ?, 0, ?, 'CASH', 'SERVING')
        `).run(orderId, tableId || null, userId || 'waiter', nowIso, subtotal, subtotal);

        const insertDetail = this.db.db.prepare(`
          INSERT INTO order_details (id, order_id, product_id, product_name, quantity, price, amount, is_printed_kitchen, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
        `);

        [...foodItems, ...drinkItems].forEach((d) => {
          insertDetail.run(d.id, orderId, d.product_id, d.product_name, d.quantity, d.price, d.amount, d.note);
        });

        if (tableId) {
          this.db.db.prepare(`
            UPDATE tables_pos SET status='OCCUPIED', active_order_id=?, current_guest_count=? WHERE id=?
          `).run(orderId, guestCount || 1, tableId);
        }

        const fullOrder = this.db.getOrder(orderId);

        // Tạo lệnh in máy in Chế biến (KITCHEN) cho Đồ ăn
        if (foodItems.length > 0 && fullOrder) {
          const foodOrderPayload = { ...fullOrder, details: foodItems };
          this.db.printJob('KITCHEN_TICKET', JSON.stringify(foodOrderPayload));
          this.broadcastKitchenEvent('KITCHEN_ORDER_NEW', { orderId, items: foodItems });
        }

        // Tạo lệnh in máy in Pha chế (BAR) cho Đồ uống
        if (drinkItems.length > 0 && fullOrder) {
          const drinkOrderPayload = { ...fullOrder, details: drinkItems };
          this.db.printJob('BAR_TICKET', JSON.stringify(drinkOrderPayload));
          this.broadcastKitchenEvent('BAR_ORDER_NEW', { orderId, items: drinkItems });
        }

        this.broadcastTableEvent('TABLE_STATUS_CHANGED', { tableId, status: 'OCCUPIED' });

        return sendJson(201, {
          id: orderId,
          orderCode: orderId,
          status: 'SERVING',
          subtotal,
          finalTotal: subtotal,
          rowVersion: 1,
        });
      } catch (err) {
        console.error('Lỗi lanCreateOrder:', err);
        return sendJson(500, { title: err.message });
      }
    }

    // 7. Transfer / Merge Order
    const transferMatch = pathname.match(/^\/api\/v1\/lan\/orders\/([^\/]+)\/transfer$/);
    if (method === 'POST' && transferMatch) {
      try {
        const orderId = transferMatch[1];
        const { targetTableId, mergeIfOccupied } = body || {};

        const order = this.db.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
        if (!order) return sendJson(404, { title: 'Không tìm thấy đơn hàng' });

        const targetTable = this.db.db.prepare('SELECT * FROM tables_pos WHERE id=?').get(targetTableId);
        if (!targetTable) return sendJson(404, { title: 'Không tìm thấy bàn đích' });

        this.db.db.prepare('UPDATE orders SET table_id=? WHERE id=?').run(targetTableId, orderId);

        if (order.table_id) {
          this.db.db.prepare("UPDATE tables_pos SET status='EMPTY', active_order_id=NULL, current_guest_count=0 WHERE id=?").run(order.table_id);
        }

        this.db.db.prepare("UPDATE tables_pos SET status='OCCUPIED', active_order_id=? WHERE id=?").run(orderId, targetTableId);

        this.broadcastTableEvent('TABLE_STATUS_CHANGED', { tableId: targetTableId, status: 'OCCUPIED' });
        return sendJson(200, { id: orderId, tableId: targetTableId, status: 'SERVING' });
      } catch (err) {
        return sendJson(500, { title: err.message });
      }
    }

    // 8. Bank Webhook (SePay / Casso / Auto Banking)
    if (method === 'POST' && (pathname === '/api/v1/lan/webhook/bank' || pathname === '/webhook/bank')) {
      try {
        const { amount, transferAmount, content, description, text, referenceCode, transId } = body || {};
        const transferVal = Number(amount || transferAmount || 0);
        const transferDesc = String(content || description || text || '').toLowerCase();

        if (transferVal <= 0) {
          return sendJson(400, { success: false, message: 'Số tiền chuyển khoản không hợp lệ' });
        }

        const openOrders = this.db.getOpenOrders();
        let matchedOrder = null;

        for (const ord of openOrders) {
          if (ord.status === 'SERVING' && transferDesc.includes(ord.id.toLowerCase())) {
            matchedOrder = ord;
            break;
          }
        }

        if (!matchedOrder) {
          for (const ord of openOrders) {
            if (ord.status === 'SERVING' && Math.abs(Number(ord.grand_total) - transferVal) < 1.0) {
              matchedOrder = ord;
              break;
            }
          }
        }

        if (matchedOrder) {
          const ref = referenceCode || transId || 'AUTO-WEBHOOK';
          this.db.checkout(matchedOrder.id, 'VIETQR', transferVal, ref);
          this.broadcastTableEvent('PAYMENT_COMPLETED', { orderId: matchedOrder.id, method: 'VIETQR', amount: transferVal });

          if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('pos:webhook:paid', { orderId: matchedOrder.id, amount: transferVal });
          }

          return sendJson(200, { success: true, message: `Đã tự động hoàn tất đơn hàng ${matchedOrder.id} với số tiền ${transferVal}` });
        }

        return sendJson(404, { success: false, message: `Không tìm thấy đơn hàng khớp với số tiền ${transferVal} hoặc nội dung chuyển khoản` });
      } catch (err) {
        console.error('Lỗi Bank Webhook:', err);
        return sendJson(500, { success: false, message: err.message });
      }
    }

    return sendJson(404, { title: 'Endpoint không tồn tại' });
  }

  initWebSocket() {
    this.server.on('upgrade', (req, socket, head) => {
      const pathname = url.parse(req.url).pathname;
      const key = req.headers['sec-websocket-key'];

      if (!key || (pathname !== '/ws/lan/tables' && pathname !== '/ws/lan/kitchen')) {
        return socket.destroy();
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ];

      socket.write(headers.join('\r\n'));

      const client = { socket, isOpen: true };
      if (pathname === '/ws/lan/tables') this.tableSockets.add(client);
      else if (pathname === '/ws/lan/kitchen') this.kitchenSockets.add(client);

      socket.on('close', () => {
        client.isOpen = false;
        this.tableSockets.delete(client);
        this.kitchenSockets.delete(client);
      });

      socket.on('error', () => {
        client.isOpen = false;
        this.tableSockets.delete(client);
        this.kitchenSockets.delete(client);
      });
    });
  }

  sendWsText(client, text) {
    if (!client.isOpen) return;
    try {
      const buffer = Buffer.from(text, 'utf-8');
      const len = buffer.length;
      let frame;

      if (len <= 125) {
        frame = Buffer.alloc(2 + len);
        frame[0] = 0x81;
        frame[1] = len;
        buffer.copy(frame, 2);
      } else if (len <= 65535) {
        frame = Buffer.alloc(4 + len);
        frame[0] = 0x81;
        frame[1] = 126;
        frame.writeUInt16BE(len, 2);
        buffer.copy(frame, 4);
      } else {
        frame = Buffer.alloc(10 + len);
        frame[0] = 0x81;
        frame[1] = 127;
        frame.writeBigUInt64BE(BigInt(len), 2);
        buffer.copy(frame, 10);
      }

      client.socket.write(frame);
    } catch (_) {
      client.isOpen = false;
    }
  }

  broadcastTableEvent(event, data) {
    const payload = JSON.stringify({ eventId: 'evt-' + Date.now() + '-' + Math.random(), event, ...data });
    this.tableSockets.forEach((client) => this.sendWsText(client, payload));
  }

  broadcastKitchenEvent(event, data) {
    const payload = JSON.stringify({ eventId: 'evt-' + Date.now() + '-' + Math.random(), event, ...data });
    this.kitchenSockets.forEach((client) => this.sendWsText(client, payload));
  }

  start(targetPort = this.port) {
    return new Promise((resolve) => {
      this.port = targetPort;
      this.running = false;
      this.lastError = null;

      const tryListen = (currentPort) => {
        const onError = (err) => {
          this.server.removeListener('listening', onListening);
          if (err.code === 'EADDRINUSE') {
            console.warn(`[LAN Server] Port ${currentPort} đang được sử dụng.`);
            if (currentPort < 8090) {
              tryListen(currentPort + 1);
            } else {
              const errorMsg = `Port 8080 - 8090 đều đang bận.`;
              this.running = false;
              this.lastError = errorMsg;
              resolve(false);
            }
          } else {
            this.running = false;
            this.lastError = err.message;
            resolve(false);
          }
        };

        const onListening = () => {
          this.server.removeListener('error', onError);
          this.port = currentPort;
          this.running = true;
          this.lastError = null;
          console.log(`[LAN Server] Native Node.js HTTP/WS Server đang chạy trên port http://0.0.0.0:${this.port}`);
          resolve(true);
        };

        this.server.once('error', onError);
        this.server.once('listening', onListening);
        this.server.listen(currentPort, '0.0.0.0');
      };

      tryListen(targetPort);
    });
  }
}

module.exports = LanServer;
