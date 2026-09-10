const { ipcRenderer } = require('electron');
let products = []; let tables = []; let areas = []; let appSettings = {}; let selectedArea = 'all'; let currentOrder = null; let selectedCategory = 'all'; let currentSession = null; let loginMode = 'password'; let staff = [];
const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
function updatePinDots(value) { document.querySelectorAll('#loginPinDots i').forEach((dot, index) => dot.classList.toggle('filled', index < String(value || '').length)); }
function pressLoginPin(value) { const input = document.getElementById('loginPin'); if (!input || input.value.length >= 6) return; input.value += value; updatePinDots(input.value); if (input.value.length >= 4) input.form?.requestSubmit(); }
function clearLoginPin() { const input = document.getElementById('loginPin'); if (input) { input.value = ''; updatePinDots(''); } }
function backspaceLoginPin() { const input = document.getElementById('loginPin'); if (input) { input.value = input.value.slice(0, -1); updatePinDots(input.value); } }
let notificationTimer = null;
function closeNotification() {
  const dialog = document.getElementById('toast');
  if (!dialog) return;
  dialog.hidden = true;
  dialog.classList.remove('is-error', 'is-success', 'is-warning');
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
}
function toast(message, titleOverride = '') {
  const dialog = document.getElementById('toast');
  const title = document.getElementById('notificationTitle');
  const content = document.getElementById('notificationMessage');
  const icon = document.getElementById('notificationIcon');
  if (!dialog || !title || !content || !icon) return;
  const text = String(message || '');
  const isError = /lỗi|thất bại|sai|không thể|không tải|chưa|vui lòng|bắt buộc|không hợp lệ/i.test(text);
  const isSuccess = /đã |thành công|hoàn tất|đã cập nhật|đã lưu|đã xóa/i.test(text) && !isError;
  const variant = isError ? 'is-error' : (isSuccess ? 'is-success' : 'is-warning');
  title.innerText = titleOverride || (isError ? 'Không thể thực hiện' : (isSuccess ? 'Thành công' : 'Thông báo'));
  content.innerText = text;
  icon.innerHTML = isError
    ? '<i class="fa-solid fa-circle-exclamation"></i>'
    : (isSuccess ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle-info"></i>');
  dialog.classList.remove('is-error', 'is-success', 'is-warning');
  dialog.classList.add(variant);
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.querySelector('.notification-close')?.focus());
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.getElementById('toast')?.hidden) closeNotification();
});
function setupClock() {
  const clock = document.getElementById('clock');
  if (!clock) return;
  const update = () => {
    const now = new Date();
    clock.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    clock.title = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  update();
  setInterval(update, 1000);
}
async function bootstrap() { currentSession = await ipcRenderer.invoke('pos:auth:current'); updateSessionDisplay(); if (currentSession) await loadApplication(); else showLogin(); }
function showLicenseGate(status) { const gate = document.getElementById('licenseGate'); if (!gate) return; gate.hidden = Boolean(status?.valid); document.getElementById('loginMachineId').innerText = status?.machineId || 'Không xác định'; const message = document.getElementById('loginLicenseStatus'); if (message) message.innerText = status?.reason || 'License chưa được kích hoạt.'; if (status?.trial && status.valid) toast(status.reason); }
async function activateLicense() { try { const key = document.getElementById('loginLicenseKey').value.trim(); if (!key) return toast('Vui lòng nhập license key.'); await ipcRenderer.invoke('pos:license:activate', key); const status = await ipcRenderer.invoke('pos:license:status'); document.getElementById('loginLicenseKey').value = ''; showLicenseGate(status); toast('Đã kích hoạt bản quyền'); } catch (error) { toast(error.message); } }
async function loadLanStatus() {
  try {
    const lan = await ipcRenderer.invoke('pos:lan:status');
    const codeHeader = document.getElementById('lanCodeHeader');
    const codeSidebar = document.getElementById('lanCodeSidebar');
    const modalCodeDisplay = document.getElementById('lanModalCodeDisplay');
    const modalIpDisplay = document.getElementById('lanModalIpDisplay');
    const modalCodeInput = document.getElementById('lanModalCodeInput');

    if (codeHeader) codeHeader.innerText = lan.pairingCode || '123456';
    if (codeSidebar) codeSidebar.innerText = lan.pairingCode || '123456';
    if (modalCodeDisplay) modalCodeDisplay.innerText = lan.pairingCode || '123456';
    if (modalIpDisplay) modalIpDisplay.innerText = `${lan.ip}:${lan.port || 8080}`;
    if (modalCodeInput && !modalCodeInput.value) modalCodeInput.value = lan.pairingCode || '123456';
  } catch (_) {}
}

async function openLanStatusModal() {
  await loadLanStatus();
  document.getElementById('lanStatusModalOverlay').style.display = 'flex';
}

function closeLanStatusModal() {
  document.getElementById('lanStatusModalOverlay').style.display = 'none';
}

async function updateLanPairingCode() {
  try {
    const codeInput = document.getElementById('lanModalCodeInput');
    const newCode = (codeInput?.value || '').trim();
    if (newCode.length !== 6 || !/^\d{6}$/.test(newCode)) {
      return toast('Mã ghép nối phải gồm đúng 6 chữ số');
    }
    const result = await ipcRenderer.invoke('pos:lan:update-code', newCode);
    await loadLanStatus();
    toast(`Đã đổi mã ghép nối Tablet thành ${result.pairingCode}`);
  } catch (error) {
    toast(`Đổi mã thất bại: ${error.message}`);
  }
}

async function loadApplication() { try { const data = await ipcRenderer.invoke('pos:bootstrap'); if (!data.license?.valid) { currentSession = null; updateSessionDisplay(); showLogin(); showLicenseGate(data.license); return; } products = data.products; tables = data.tables; areas = data.areas; appSettings = data.settings || {}; renderProducts(); renderFloorTabs(); renderFloorGrid(); renderInventory(); renderStockEntryProducts(); renderStockEntryItems(); renderOrderTable(); updateSessionDisplay(); renderConfigSettings(); await updateLicenseStatus(); await loadLanStatus(); ensureLoyaltySettings(); ensurePrintTemplateSettings(); ensurePrintPreviewToggle(); ensureReportPrintControls(); await loadWindowsPrinters(); hideLogin(); await loadStaff(); await loadCustomers(); } catch (error) { toast(`Không tải được dữ liệu: ${error.message}`); } }
async function updateLicenseStatus() { const status = await ipcRenderer.invoke('pos:license:status'); const machine = document.getElementById('configMachineId'); const label = document.getElementById('licenseStatus'); const headerLabel = document.getElementById('headerLicenseLabel'); const packageLabel = document.getElementById('configLicensePackage'); const expiryLabel = document.getElementById('configLicenseExpiry'); const devicesLabel = document.getElementById('configLicenseDevices'); const keyGroup = document.getElementById('configLicenseKeyGroup'); const activateButton = document.getElementById('configActivateLicenseButton'); const packageName = status.payload?.pkg || (status.trial ? 'TRIAL' : ''); if (machine) machine.innerText = status.machineId || '-'; if (label) label.innerText = status.valid ? status.reason : (status.revoked ? 'Đã thu hồi' : 'Chưa kích hoạt'); if (headerLabel) headerLabel.innerText = status.valid ? `Đã đăng ký bản quyền gói ${packageName}` : 'Chưa đăng ký bản quyền'; if (packageLabel) packageLabel.innerText = packageName || '-'; if (expiryLabel) expiryLabel.innerText = status.payload?.exp || (status.trial ? status.trialExpiresAt?.slice(0, 10) : 'Vĩnh viễn'); if (devicesLabel) devicesLabel.innerText = status.payload?.dev ? `${status.payload.dev} thiết bị` : '-'; if (keyGroup) keyGroup.hidden = Boolean(status.valid); if (activateButton) activateButton.hidden = Boolean(status.valid); }
async function refreshLicenseEnforcement() { try { const status = await ipcRenderer.invoke('pos:license:status'); await updateLicenseStatus(); if (status.revoked && currentSession) { await ipcRenderer.invoke('pos:auth:logout'); currentSession = null; updateSessionDisplay(); showLogin(); toast('License đã bị thu hồi. Vui lòng liên hệ NINOTEK để được hỗ trợ.', 'Bản quyền'); } } catch (error) { console.error('License status refresh failed:', error); } }
async function showLogin() { document.getElementById('loginOverlay').hidden = false; showLicenseGate(await ipcRenderer.invoke('pos:license:status')); document.getElementById('loginUsername')?.focus(); }
function hideLogin() { document.getElementById('loginOverlay').hidden = true; }
function updateSessionDisplay() { const name = document.querySelector('.user-name'); const role = document.querySelector('.user-role'); if (name) name.innerText = currentSession ? `${currentSession.full_name} (${currentSession.role})` : 'Chưa đăng nhập'; if (role) role.innerText = currentSession ? 'Phiên làm việc cục bộ' : ''; updateRoleBasedUi(); }
function updateRoleBasedUi() {
  const isAdmin = currentSession?.role === 'ADMIN';
  document.querySelectorAll('#inventory-view .inv-modern-table th:last-child, #inventory-view .inv-modern-table td:last-child').forEach((cell) => { cell.hidden = !isAdmin; });
  document.querySelectorAll('#report-view .analytics-filter-toolbar, #report-view .kpi-metrics-row, #report-view .analytics-charts-row').forEach((section) => { section.hidden = !isAdmin; });
  const cancelButton = document.getElementById('analyticsCancelOrderButton');
  if (cancelButton) cancelButton.hidden = !isAdmin;
}
function openCredentialsModal() { if (!currentSession) return toast('Vui lòng đăng nhập trước.'); document.getElementById('credentialsForm')?.reset(); document.getElementById('credentialsModalOverlay').style.display = 'flex'; document.getElementById('credentialsCurrentPassword')?.focus(); }
function closeCredentialsModal() { document.getElementById('credentialsModalOverlay').style.display = 'none'; }
async function saveCredentials(event) { event.preventDefault(); try { const nextPassword = document.getElementById('credentialsNextPassword').value; const nextPin = document.getElementById('credentialsNextPin').value.trim(); if (!nextPassword && !nextPin) return toast('Hãy nhập mật khẩu mới hoặc PIN mới.'); currentSession = await ipcRenderer.invoke('pos:auth:credentials', document.getElementById('credentialsCurrentPassword').value, nextPassword, nextPin); updateSessionDisplay(); closeCredentialsModal(); toast('Đã cập nhật thông tin đăng nhập'); } catch (error) { toast(`Đổi thông tin đăng nhập thất bại: ${error.message}`); } }
function roleLabel(role) { return { ADMIN: 'Quản trị', CASHIER: 'Thu ngân', WAITER: 'Phục vụ' }[role] || role; }
async function loadStaff() { const staffNav = document.querySelector('[data-config-pane="config-staff"]'); const staffPane = document.getElementById('config-staff'); const settingsTab = document.getElementById('settingsTab'); const isAdmin = currentSession?.role === 'ADMIN'; if (staffNav) staffNav.hidden = !isAdmin; if (staffPane) staffPane.hidden = !isAdmin; if (settingsTab) settingsTab.hidden = !isAdmin; if (!isAdmin) return; try { staff = await ipcRenderer.invoke('pos:users:list'); renderStaff(); } catch (error) { toast(error.message); } }
function renderStaff() { const body = document.getElementById('staffTableBody'); if (!body) return; const query = (document.getElementById('staffSearchInput')?.value || '').toLowerCase(); body.innerHTML = ''; staff.filter((user) => !query || `${user.username} ${user.full_name} ${user.pin_code || ''}`.toLowerCase().includes(query)).forEach((user) => { const row = document.createElement('tr'); row.innerHTML = `<td><strong>${user.full_name}</strong></td><td>${user.username}</td><td>${roleLabel(user.role)}</td><td class="center-col">${user.pin_code || '-'}</td><td class="center-col">${user.status === 'ACTIVE' ? 'Đang làm việc' : 'Tạm khóa'}</td><td class="center-col"><button class="action-icon-btn" title="Sửa" onclick="editStaff('${user.id}')"><i class="fa-solid fa-pen"></i></button><button class="action-icon-btn" title="Phân quyền" onclick="openPermissionModal('${user.id}')"><i class="fa-solid fa-shield-halved"></i></button></td>`; body.appendChild(row); }); }
let permissionUserId = null; let permissionCatalog = null; let permissionValues = {};
async function openPermissionModal(userId) { try { const user = staff.find((item) => item.id === userId); permissionUserId = userId; permissionCatalog = permissionCatalog || await ipcRenderer.invoke('pos:permissions:catalog'); permissionValues = await ipcRenderer.invoke('pos:permissions:get', userId); document.getElementById('permissionUserLabel').innerText = `Tài khoản: ${user?.full_name || userId} (${roleLabel(user?.role)})`; document.getElementById('permissionGroups').innerHTML = permissionCatalog.groups.map((group) => `<section class="permission-group"><h4>${group.label}</h4>${group.items.map((item) => `<label><span>${item.label}</span><input type="checkbox" data-permission-key="${item.key}" ${permissionValues[item.key] ? 'checked' : ''}></label>`).join('')}</section>`).join(''); document.getElementById('permissionModalOverlay').style.display = 'flex'; } catch (error) { toast(`Không tải được quyền: ${error.message}`); } }
function closePermissionModal() { document.getElementById('permissionModalOverlay').style.display = 'none'; permissionUserId = null; }
async function savePermissions() { if (!permissionUserId) return; const permissions = Object.fromEntries([...document.querySelectorAll('[data-permission-key]')].map((input) => [input.dataset.permissionKey, input.checked])); try { await ipcRenderer.invoke('pos:permissions:update', permissionUserId, permissions); staff = await ipcRenderer.invoke('pos:users:list'); renderStaff(); closePermissionModal(); toast('Đã lưu phân quyền cho nhân viên'); } catch (error) { toast(`Lưu phân quyền thất bại: ${error.message}`); } }
function renderConfigSettings() { if (currentSession?.role !== 'ADMIN') return; const set = (id, value) => { const element = document.getElementById(id); if (element) element.value = value || ''; }; const check = (id, value, fallback = true) => { const element = document.getElementById(id); if (element) element.checked = value === undefined ? fallback : value !== '0'; }; set('configStoreName', appSettings['store.name']); set('configStorePhone', appSettings['store.phone']); set('configStoreAddress', appSettings['store.address']); set('configStoreLogo', appSettings['store.logo']); set('configBillFooter', appSettings['store.bill_footer']); check('configInvoiceQr', appSettings['invoice.qr']); if (!document.getElementById('configFacebook')) { const address = document.getElementById('configStoreAddress'); const facebook = document.createElement('input'); facebook.id = 'configFacebook'; facebook.placeholder = 'https://facebook.com/...'; facebook.value = appSettings['store.facebook'] || ''; facebook.className = address?.className || ''; const group = document.createElement('div'); group.className = 'form-group config-span-2'; group.innerHTML = '<label>Địa chỉ Facebook</label>'; group.appendChild(facebook); address?.closest('.config-form-grid')?.appendChild(group); } if (!document.getElementById('configLogoUpload')) { const logo = document.getElementById('configStoreLogo'); const button = document.createElement('button'); button.id = 'configLogoUpload'; button.type = 'button'; button.className = 'btn btn-outline btn-sm'; button.innerHTML = '<i class="fa-solid fa-upload"></i> Tải logo từ máy'; button.onclick = uploadBrandLogo; logo?.parentElement?.appendChild(button); } [['bill','Bill tính tiền'],['kitchen','Bill chế biến'],['bar','Bill pha chế'],['report','Báo cáo A4/A5']].forEach(([key]) => { set(`printer${key[0].toUpperCase() + key.slice(1)}Kind`, appSettings[`printer.${key}.kind`]); set(`printer${key[0].toUpperCase() + key.slice(1)}Name`, appSettings[`printer.${key}.name`]); set(`printer${key[0].toUpperCase() + key.slice(1)}Port`, appSettings[`printer.${key}.port`]); }); set('configPrinterKind', appSettings['printer.kind'] || 'WindowsSpooler'); set('configPrinterName', appSettings['printer.name']); set('configPrinterHost', appSettings['printer.host']); set('configPrinterPort', appSettings['printer.port'] || '9100'); set('configBankBin', appSettings['payment.bank.bin']); set('configBankAccount', appSettings['payment.bank.account']); set('configBankName', appSettings['payment.bank.name']); set('configLicenseKey', appSettings['license.key']); const licenseStatus = document.getElementById('licenseStatus'); if (licenseStatus) licenseStatus.innerText = appSettings['license.key'] ? 'Đã cấp key' : 'Chưa kích hoạt'; check('configPayCash', appSettings['payment.cash']); check('configPayQr', appSettings['payment.qr']); check('configPayCard', appSettings['payment.card']); set('configVatRate', appSettings['vat.default'] || '8'); set('configDiscountLimit', appSettings['discount.cashier_limit'] || '10'); set('configServiceCharge', appSettings['service.charge'] || '0'); set('configSurcharge', appSettings['service.surcharge'] || '0'); check('configVatIncluded', appSettings['vat.included'], false); check('configVatEnabled', appSettings['vat.default']); check('configAutoPrint', appSettings['pos.auto_print']); check('configStockWarning', appSettings['pos.stock_warning']); if (!document.getElementById('configAllowNegative')) { const pane = document.querySelector('#config-pos .config-toggle-list'); if (pane) pane.insertAdjacentHTML('beforeend', '<label><span><strong>Cho phép bán âm kho</strong><small>Cho phép thanh toán khi tồn kho không đủ.</small></span><input id="configAllowNegative" type="checkbox" class="modern-switch"></label>'); } check('configAllowNegative', appSettings['inventory.allow_negative'], false); ipcRenderer.invoke('pos:payments:banks').then((banks) => { const input = document.getElementById('configBankBin'); if (!input) return; const select = document.createElement('select'); select.id = 'configBankBin'; select.innerHTML = banks.map((bank) => `<option value="${bank.bin}">${bank.shortName} - ${bank.name}</option>`).join(''); select.value = appSettings['payment.bank.bin'] || ''; input.replaceWith(select); }).catch(() => {});
  ipcRenderer.invoke('pos:lan:info').then((info) => {
    const urlInput = document.getElementById('configBankWebhookUrl');
    if (urlInput) urlInput.value = `http://${info.ip}:${info.port}/api/v1/lan/webhook/bank`;
  }).catch(() => {
    const urlInput = document.getElementById('configBankWebhookUrl');
    if (urlInput) urlInput.value = `http://127.0.0.1:8080/api/v1/lan/webhook/bank`;
  });
  loadPromotions();
}

async function copyWebhookUrl() {
  const input = document.getElementById('configBankWebhookUrl');
  if (!input || !input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Đã sao chép URL Webhook vào bộ nhớ tạm!');
  } catch (_) {
    input.select();
    document.execCommand('copy');
    toast('Đã sao chép URL Webhook!');
  }
}
async function saveSettings(values, message) { try { for (const [key, value] of Object.entries(values)) { await ipcRenderer.invoke('pos:settings:set', key, value); appSettings[key] = String(value); } toast(message); } catch (error) { toast(`Lưu cấu hình thất bại: ${error.message}`); } }
function ensureLoyaltySettings() { const pane = document.querySelector('#config-vietqr .config-scroll'); if (!pane || document.getElementById('loyaltySettingsCard')) return; const card = document.createElement('div'); card.id = 'loyaltySettingsCard'; card.className = 'loyalty-settings-card'; card.innerHTML = '<h4><i class="fa-solid fa-star"></i> Tích điểm & chiết khấu khách hàng</h4><div class="config-form-grid"><div class="form-group"><label>Chi tiêu để được 1 điểm (VNĐ)</label><input id="configLoyaltyPointsPerAmount" type="number" min="1"></div><div class="form-group"><label>Giá trị giảm của 1 điểm (VNĐ)</label><input id="configLoyaltyDiscountPerPoint" type="number" min="1"></div></div><small>Ví dụ: 10.000 VNĐ = 1 điểm; 1 điểm giảm 100 VNĐ khi thanh toán.</small>'; pane.appendChild(card); card.querySelector('#configLoyaltyPointsPerAmount').value = appSettings['loyalty.points_per_amount'] || '10000'; card.querySelector('#configLoyaltyDiscountPerPoint').value = appSettings['loyalty.discount_per_point'] || '100'; }
function ensurePrintPreviewToggle() { const actions = document.querySelector('.config-test-actions'); if (!actions || document.getElementById('configBillPreviewEnabled')) return; const label = document.createElement('label'); label.className = 'print-preview-toggle'; label.innerHTML = '<span><strong>Cho phép xem trước khi in</strong><small>Bật để mở hộp thoại xem trước trước khi gửi bill đến máy in.</small></span><input id="configBillPreviewEnabled" type="checkbox" class="modern-switch">'; actions.parentElement.insertBefore(label, actions); document.getElementById('configBillPreviewEnabled').checked = appSettings['printer.bill.preview_before_print'] === '1'; }
function ensurePrintTemplateSettings() { const pane = document.querySelector('#config-printer .config-scroll'); if (!pane || document.getElementById('printTemplateSettings')) return; const card = document.createElement('div'); card.id = 'printTemplateSettings'; card.className = 'loyalty-settings-card'; card.innerHTML = '<h4><i class="fa-solid fa-receipt"></i> Mẫu bill K58/K80</h4><div class="config-form-grid"><div class="form-group"><label>Khổ bill</label><select id="configBillWidth"><option value="K80">K80 (48 ký tự)</option><option value="K58">K58 (32 ký tự)</option></select></div><div class="form-group"><label>Nội dung chân bill</label><textarea id="configPrinterBillFooter" rows="3" placeholder="Cảm ơn Quý khách..."></textarea></div><div class="form-group config-span-2"><label>Trình sửa bill K80</label><div id="billEditorToolbar" class="bill-editor-toolbar"><button type="button" data-command="bold"><b>B</b></button><button type="button" data-command="justifyCenter">Căn giữa</button><button type="button" data-token="{{store.name}}">+ Tên quán</button><button type="button" data-token="{{items}}">+ Bảng món</button><button type="button" data-token="{{total}}">+ Tổng tiền</button><button type="button" data-token="{{qr}}">+ VietQR</button></div><div id="configBillHtmlTemplate" class="bill-html-editor" contenteditable="true"></div><small class="print-template-help">Chỉnh sửa trực tiếp trên khổ 72mm. Chọn nút token để chèn biến động vào vị trí con trỏ.</small></div><div class="form-group config-span-2" hidden><textarea id="configBillTemplate" rows="16" spellcheck="false"></textarea></div></div><button type="button" id="openBillPreviewButton" class="btn btn-primary print-template-preview-btn"><i class="fa-solid fa-eye"></i> Xem trước Bill</button>'; pane.appendChild(card); document.getElementById('openBillPreviewButton').addEventListener('click', openBillPreview); document.getElementById('configBillWidth').value = appSettings['printer.bill.width'] || 'K80'; document.getElementById('configPrinterBillFooter').value = appSettings['printer.bill.footer'] || 'Cam on quy khach!'; const savedTemplate = appSettings['printer.bill.html_template'] || '<div class="center"><strong>{{store.name}}</strong><div>{{store.address}}</div><div>{{store.phone}}</div><div class="divider"></div><strong>{{title}}</strong></div><div class="meta"><span>HĐ: #{{order.id}}</span><span>Bàn: {{order.table}}</span></div><div class="meta"><span>Ngày: {{order.date}}</span><span>Giờ: {{order.time}}</span></div><div class="divider"></div><table><thead><tr><th>Món</th><th>SL</th><th>T.Tiền</th></tr></thead><tbody>{{items}}</tbody></table><div class="divider"></div><table class="total-block"><tr><td>Tổng tiền món:</td><td>{{subtotal}}</td></tr><tr><td>VAT:</td><td>{{vat}}</td></tr><tr class="grand-total"><td>THANH TOÁN:</td><td>{{total}} đ</td></tr></table><div class="divider"></div>{{qr}}<div class="center footer">{{footer}}</div>'; document.getElementById('configBillHtmlTemplate').innerHTML = savedTemplate; document.getElementById('configBillTemplate').value = savedTemplate; document.querySelectorAll('#billEditorToolbar button').forEach((button) => button.addEventListener('click', () => { const editor = document.getElementById('configBillHtmlTemplate'); editor.focus(); if (button.dataset.command) document.execCommand(button.dataset.command); if (button.dataset.token) document.execCommand('insertText', false, button.dataset.token); })); }
async function uploadBrandLogo() { try { const result = await ipcRenderer.invoke('pos:settings:upload-logo'); if (!result.canceled) { document.getElementById('configStoreLogo').value = result.imageUrl; toast('Đã tải logo thương hiệu'); } } catch (error) { toast(`Tải logo thất bại: ${error.message}`); } }
function saveConfigGeneral() { saveSettings({ 'store.name': document.getElementById('configStoreName').value.trim(), 'store.phone': document.getElementById('configStorePhone').value.trim(), 'store.address': document.getElementById('configStoreAddress').value.trim(), 'store.facebook': document.getElementById('configFacebook')?.value.trim() || '', 'store.logo': document.getElementById('configStoreLogo').value.trim(), 'store.bill_footer': document.getElementById('configBillFooter').value, 'invoice.qr': document.getElementById('configInvoiceQr').checked ? '1' : '0' }, 'Đã lưu thông tin điểm bán'); }
function saveConfigPrinter() { const values = {}; [['bill','Bill tính tiền'],['kitchen','Bill chế biến'],['bar','Bill pha chế'],['report','Báo cáo A4/A5']].forEach(([key]) => { const cap = key[0].toUpperCase() + key.slice(1); values[`printer.${key}.kind`] = document.getElementById(`printer${cap}Kind`).value; values[`printer.${key}.name`] = document.getElementById(`printer${cap}Name`).value.trim(); values[`printer.${key}.port`] = document.getElementById(`printer${cap}Port`).value || '9100'; }); values['printer.bill.width'] = document.getElementById('configBillWidth')?.value || 'K80'; values['printer.bill.footer'] = document.getElementById('configPrinterBillFooter')?.value || ''; values['printer.bill.html_template'] = document.getElementById('configBillHtmlTemplate')?.innerHTML || ''; values['printer.bill.template'] = document.getElementById('configBillTemplate')?.value || ''; values['printer.bill.preview_before_print'] = document.getElementById('configBillPreviewEnabled')?.checked ? '1' : '0'; saveSettings(values, 'Đã lưu cấu hình máy in và mẫu bill'); }
function openBillPreview() { closeBillPreview(); const width = document.getElementById('configBillWidth')?.value === 'K58' ? 32 : 48; const template = document.getElementById('configBillTemplate')?.value || ''; const values = { '{{store.name}}': appSettings['store.name'] || 'NinoPOS', '{{store.address}}': appSettings['store.address'] || '123 Đường Mẫu', '{{store.phone}}': appSettings['store.phone'] || '0900 000 000', '{{separator}}': '='.repeat(width), '{{title}}': 'PHIẾU THANH TOÁN', '{{order.id}}': 'HD-DEMO-001', '{{order.table}}': 'Bàn 01', '{{order.customer}}': 'Khách lẻ', '{{order.date}}': new Date().toLocaleDateString('vi-VN'), '{{order.time}}': new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), '{{items}}': `Đậu Phộng Rang              1       25.000\nTrà Đào Cam Sả              1       35.000\nMực Trứng Nướng             1      160.000`, '{{subtotal}}': '220.000', '{{vat}}': '17.600', '{{total}}': '237.600 đ', '{{payment}}': 'Tiền mặt', '{{footer}}': document.getElementById('configPrinterBillFooter')?.value || 'Cam on quy khach!' }; const content = template.split(/\r?\n/).map((item) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(key, value), item)).join('\n'); const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.id = 'billPreviewOverlay'; overlay.style.display = 'flex'; overlay.innerHTML = `<div class="modal-card bill-preview-modal"><div class="modal-header"><h3><i class="fa-solid fa-eye"></i> Xem trước Bill ${width === 32 ? 'K58' : 'K80'}</h3><button class="close-modal" type="button" id="closeBillPreviewButton">&times;</button></div><div class="modal-body"><pre class="bill-preview-paper">${content.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div><div class="modal-footer"><button class="btn btn-secondary" type="button" id="closeBillPreviewFooterButton">Đóng</button></div></div>`; document.body.appendChild(overlay); overlay.querySelector('#closeBillPreviewButton').addEventListener('click', closeBillPreview); overlay.querySelector('#closeBillPreviewFooterButton').addEventListener('click', closeBillPreview); }
function closeBillPreview() { document.getElementById('billPreviewOverlay')?.remove(); }
async function loadWindowsPrinters(showMessage = false) { try { const printers = await ipcRenderer.invoke('pos:printer:list'); const uniquePrinters = Array.from(new Map(printers.map((item) => [item.name, item])).values()); let list = document.getElementById('windowsPrinterList'); if (!list) { list = document.createElement('datalist'); list.id = 'windowsPrinterList'; document.body.appendChild(list); } list.innerHTML = uniquePrinters.map((item) => `<option value="${String(item.name).replace(/"/g, '&quot;')}">${item.displayName}</option>`).join(''); ['Bill', 'Kitchen', 'Bar', 'Report'].forEach((cap) => { const input = document.getElementById(`printer${cap}Name`); if (input) { input.setAttribute('list', 'windowsPrinterList'); let picker = document.getElementById(`printer${cap}PrinterPicker`); if (!picker) { picker = document.createElement('select'); picker.id = `printer${cap}PrinterPicker`; picker.className = 'printer-picker'; picker.innerHTML = '<option value="">Chọn máy in Windows...</option>'; input.insertAdjacentElement('beforebegin', picker); picker.addEventListener('change', () => { if (picker.value) input.value = picker.value; }); } picker.innerHTML = '<option value="">Chọn máy in Windows...</option>' + uniquePrinters.map((item) => `<option value="${String(item.name).replace(/"/g, '&quot;')}">${item.displayName || item.name}</option>`).join(''); picker.value = uniquePrinters.some((item) => item.name === input.value) ? input.value : ''; } }); const actions = document.querySelector('.config-test-actions'); if (actions && !document.getElementById('refreshWindowsPrinters')) { const button = document.createElement('button'); button.id = 'refreshWindowsPrinters'; button.className = 'btn btn-outline'; button.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Tải danh sách máy in'; button.onclick = () => loadWindowsPrinters(true); actions.prepend(button); } if (showMessage) toast(uniquePrinters.length ? `Đã tải ${uniquePrinters.length} máy in Windows` : 'Không tìm thấy máy in Windows.'); } catch (error) { toast(`Không tải được danh sách máy in: ${error.message}`); } }
async function testConfiguredPrinter(type) { try { const cap = type[0].toUpperCase() + type.slice(1); const config = { kind: document.getElementById(`printer${cap}Kind`).value, name: document.getElementById(`printer${cap}Name`).value.trim(), port: document.getElementById(`printer${cap}Port`).value }; if (config.kind === 'WindowsSpooler' && !config.name) return toast('Hãy chọn máy in Windows hoặc nhập tên máy in.'); await ipcRenderer.invoke('pos:printer:test', type, config); toast('Đã gửi lệnh in thử'); } catch (error) { toast(`In thử thất bại: ${error.message}`); } }
function saveConfigVietQr() { saveSettings({ 'payment.bank.bin': document.getElementById('configBankBin').value.trim(), 'payment.bank.account': document.getElementById('configBankAccount').value.trim(), 'payment.bank.name': document.getElementById('configBankName').value.trim(), 'payment.pos.host': document.getElementById('configPosTerminalHost').value.trim(), 'payment.pos.port': document.getElementById('configPosTerminalPort').value, 'payment.cash': document.getElementById('configPayCash').checked ? '1' : '0', 'payment.qr': document.getElementById('configPayQr').checked ? '1' : '0', 'payment.card': document.getElementById('configPayCard').checked ? '1' : '0', 'loyalty.points_per_amount': document.getElementById('configLoyaltyPointsPerAmount').value, 'loyalty.discount_per_point': document.getElementById('configLoyaltyDiscountPerPoint').value }, 'Đã lưu cấu hình thanh toán và tích điểm'); }
function saveConfigTax() { saveSettings({ 'vat.default': document.getElementById('configVatRate').value, 'vat.included': document.getElementById('configVatIncluded').checked ? '1' : '0', 'discount.cashier_limit': document.getElementById('configDiscountLimit').value, 'service.charge': document.getElementById('configServiceCharge').value, 'service.surcharge': document.getElementById('configSurcharge').value }, 'Đã lưu thuế, phí và khuyến mãi'); }
async function loadPromotions() { try { const promotions = await ipcRenderer.invoke('pos:promotions:list'); const target = document.getElementById('promotionList'); if (target) target.innerHTML = promotions.map((item) => `<div class="promotion-row"><span><strong>${item.name}</strong><small>${item.discount_type === 'PERCENT' ? `${item.discount_value}%` : money(item.discount_value)} | ${new Date(item.starts_at).toLocaleString('vi-VN')} - ${new Date(item.ends_at).toLocaleString('vi-VN')}</small></span><button class="action-icon-btn delete" onclick="deletePromotion('${item.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join('') || '<small>Chưa có chương trình.</small>'; } catch (_) {} }
async function createPromotion() { try { await ipcRenderer.invoke('pos:promotions:create', { name: document.getElementById('promotionName').value, discount_type: document.getElementById('promotionType').value, discount_value: Number(document.getElementById('promotionValue').value || 0), starts_at: document.getElementById('promotionStart').value, ends_at: document.getElementById('promotionEnd').value }); await loadPromotions(); toast('Đã tạo chương trình khuyến mãi'); } catch (error) { toast(error.message); } }
async function deletePromotion(id) { try { await ipcRenderer.invoke('pos:promotions:delete', id); await loadPromotions(); toast('Đã xóa chương trình'); } catch (error) { toast(error.message); } }
async function saveLicenseKey() { try { const key = document.getElementById('configLicenseKey').value.trim(); if (!key) return toast('Vui lòng nhập license key.'); await ipcRenderer.invoke('pos:license:activate', key); await updateLicenseStatus(); toast('Đã kích hoạt bản quyền'); } catch (error) { toast(error.message); } }
function saveConfigPos() { saveSettings({ 'vat.default': document.getElementById('configVatEnabled').checked ? '8' : '0', 'pos.auto_print': document.getElementById('configAutoPrint').checked ? '1' : '0', 'pos.stock_warning': document.getElementById('configStockWarning').checked ? '1' : '0', 'inventory.allow_negative': document.getElementById('configAllowNegative').checked ? '1' : '0' }, 'Đã lưu tùy chọn bán hàng'); }
function openConfigView(viewId) { document.querySelector(`[data-view="${viewId}"]`)?.click(); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function setAnalyticsPreset(days) { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - Number(days)); document.getElementById('analyticsFrom').value = isoDate(start); document.getElementById('analyticsTo').value = isoDate(end); }
function paymentLabel(method) { return { CASH: 'Tiền mặt', VIETQR: 'VietQR', CARD: 'Thẻ', OTHER: 'Khác' }[method] || method; }
async function loadAnalytics() { try { const from = document.getElementById('analyticsFrom').value; const to = document.getElementById('analyticsTo').value; if (!from || !to || from > to) return toast('Khoảng ngày báo cáo không hợp lệ'); const report = await ipcRenderer.invoke('pos:analytics:report', from, to); document.getElementById('analyticsRevenue').innerText = money(report.totals.revenue); document.getElementById('analyticsInvoices').innerText = Number(report.totals.invoices || 0).toLocaleString('vi-VN'); document.getElementById('analyticsAverage').innerText = `Trung bình ${money(report.totals.average)}`; document.getElementById('analyticsTopProduct').innerText = report.topProduct?.product_name || 'Chưa có dữ liệu'; document.getElementById('analyticsTopQuantity').innerText = `${Number(report.topProduct?.quantity || 0).toLocaleString('vi-VN')} món`; const paymentTotal = report.payments.reduce((sum, item) => sum + Number(item.total), 0); document.getElementById('analyticsPaymentMix').innerText = report.payments.length ? paymentLabel(report.payments.slice().sort((a, b) => b.total - a.total)[0].method) : 'Chưa có dữ liệu'; document.getElementById('analyticsPaymentChart').innerHTML = report.payments.length ? report.payments.map((item) => `<div class="payment-row"><span>${paymentLabel(item.method)}</span><strong>${money(item.total)}</strong><small>${paymentTotal ? Math.round(item.total / paymentTotal * 100) : 0}%</small></div>`).join('') : '<p class="analytics-empty">Chưa có dữ liệu</p>'; const maxDaily = Math.max(...report.daily.map((item) => Number(item.total)), 1); document.getElementById('analyticsDailyChart').innerHTML = report.daily.length ? report.daily.map((item) => `<div class="daily-bar-item"><div class="daily-bar" style="height:${Math.max(8, item.total / maxDaily * 150)}px" title="${money(item.total)}"></div><small>${item.day.slice(5)}</small></div>`).join('') : '<p class="analytics-empty">Chưa có dữ liệu</p>'; renderAnalyticsOrders(report.orders); } catch (error) { toast(`Không tải được báo cáo: ${error.message}`); } }
function renderAnalyticsOrders(orders) { const body = document.getElementById('analyticsOrderTable'); if (!body) return; const query = (document.getElementById('analyticsOrderSearch')?.value || '').toLowerCase(); body.innerHTML = ''; orders.filter((order) => !query || `${order.id} ${order.table_name || ''} ${order.customer_name || ''} ${order.cashier_name || ''}`.toLowerCase().includes(query)).forEach((order) => { const method = (order.payment_method || 'OTHER').split(':')[0]; const row = document.createElement('tr'); row.className = 'clickable-row'; row.title = 'Bấm để xem chi tiết hóa đơn'; row.innerHTML = `<td>${order.id}</td><td>${order.table_name || 'Mang đi'}</td><td>${order.customer_name || 'Vãng lai'}</td><td>${new Date(order.check_out_time).toLocaleString('vi-VN')}</td><td>${order.cashier_name || '-'}</td><td>${paymentLabel(method)}</td><td class="right-col"><strong>${money(order.grand_total)}</strong></td><td><button class="action-icon-btn" title="Xem chi tiết" onclick="event.stopPropagation(); openAnalyticsOrder('${order.id}')"><i class="fa-solid fa-eye"></i></button></td>`; row.addEventListener('click', () => openAnalyticsOrder(order.id)); body.appendChild(row); }); }
let selectedAnalyticsOrder = null;
let cancelReasonResolver = null;
function showTextInputModal() { document.getElementById('cancelReasonInput').value = ''; document.getElementById('cancelReasonModal').style.display = 'flex'; document.getElementById('cancelReasonInput').focus(); return new Promise((resolve) => { cancelReasonResolver = resolve; }); }
function resolveCancelReason(value) { document.getElementById('cancelReasonModal').style.display = 'none'; if (cancelReasonResolver) { const resolve = cancelReasonResolver; cancelReasonResolver = null; resolve(String(value || '').trim()); } }
async function openAnalyticsOrder(orderId) { try { selectedAnalyticsOrder = await ipcRenderer.invoke('pos:analytics:order', orderId); const order = selectedAnalyticsOrder; document.getElementById('analyticsOrderDetail').innerHTML = `<div class="order-detail-summary"><p><strong>Mã hóa đơn:</strong> ${order.id}</p><p><strong>Khách hàng:</strong> ${order.customer_name || 'Vãng lai'}</p><p><strong>Bàn:</strong> ${order.table_name || 'Mang đi'}</p><p><strong>Thanh toán:</strong> ${paymentLabel((order.payment_method || 'OTHER').split(':')[0])}</p></div><table class="data-table"><thead><tr><th>Món</th><th>SL</th><th class="right-col">Thành tiền</th></tr></thead><tbody>${order.details.map((item) => `<tr><td>${item.product_name}</td><td>${item.quantity}</td><td class="right-col">${money(item.amount)}</td></tr>`).join('')}</tbody></table><p class="order-detail-total"><strong>Tổng cộng: ${money(order.grand_total)}</strong></p><p class="order-detail-note">${order.note || ''}</p>`; document.getElementById('analyticsCancelOrderButton').hidden = currentSession?.role !== 'ADMIN' || order.status !== 'PAID'; document.getElementById('analyticsOrderModal').style.display = 'flex'; } catch (error) { toast(error.message); } }
function closeAnalyticsOrderModal() { document.getElementById('analyticsOrderModal').style.display = 'none'; selectedAnalyticsOrder = null; }
async function openCancelOrderReason() { if (!selectedAnalyticsOrder) return; const reason = await showTextInputModal('Lý do hủy đơn', 'Nhập lý do hủy đơn (bắt buộc)'); if (!reason) return; try { await ipcRenderer.invoke('pos:analytics:cancel-order', selectedAnalyticsOrder.id, reason); closeAnalyticsOrderModal(); await loadAnalytics(); toast('Đã hủy đơn và hoàn kho thành công'); } catch (error) { toast(error.message); } }
async function reprintAnalyticsOrder(orderId) { try { await ipcRenderer.invoke('pos:print:temporary', orderId); toast('Đã đưa hóa đơn vào hàng đợi in lại'); } catch (error) { toast(error.message); } }
async function backupDatabase() { try { const result = await ipcRenderer.invoke('pos:database:backup'); if (!result.canceled) toast(`Đã sao lưu database: ${result.file}`); } catch (error) { toast(`Sao lưu thất bại: ${error.message}`); } }
async function loadAuditLogs() { try { const logs = await ipcRenderer.invoke('pos:audit:list'); const target = document.getElementById('configAuditList'); if (!logs.length) return target.innerText = 'Chưa có nhật ký hoạt động.'; target.innerHTML = logs.slice(0, 40).map((log) => `<div class="audit-row"><strong>${log.action}</strong><span>${log.entity_type || ''} ${log.entity_id || ''}</span><small>${new Date(log.created_at).toLocaleString('vi-VN')}</small></div>`).join(''); } catch (error) { toast(`Không tải được nhật ký: ${error.message}`); } }
function resetStaffForm() { document.getElementById('staffForm')?.reset(); document.getElementById('staffId').value = ''; document.getElementById('staffUsername').disabled = false; }
function openStaffModal(id = null) { resetStaffForm(); const user = id ? staff.find((item) => item.id === id) : null; document.getElementById('staffModalTitle').innerHTML = `<i class="fa-solid fa-user-gear"></i> ${user ? 'Sửa nhân viên' : 'Thêm nhân viên'}`; if (user) { document.getElementById('staffId').value = user.id; document.getElementById('staffUsername').value = user.username; document.getElementById('staffUsername').disabled = true; document.getElementById('staffFullName').value = user.full_name; document.getElementById('staffPin').value = user.pin_code || ''; document.getElementById('staffRole').value = user.role; document.getElementById('staffStatus').value = user.status; } document.getElementById('staffModalOverlay').style.display = 'flex'; }
function closeStaffModal() { document.getElementById('staffModalOverlay').style.display = 'none'; }
function editStaff(id) { openStaffModal(id); }
async function saveStaff(event) { event.preventDefault(); try { const id = document.getElementById('staffId').value; const payload = { username: document.getElementById('staffUsername').value.trim(), full_name: document.getElementById('staffFullName').value.trim(), password: document.getElementById('staffPassword').value, pin_code: document.getElementById('staffPin').value.trim() || null, role: document.getElementById('staffRole').value }; if (id) await ipcRenderer.invoke('pos:users:update', id, { full_name: payload.full_name, role: payload.role, pin_code: payload.pin_code, status: document.getElementById('staffStatus').value, password: payload.password || undefined }); else await ipcRenderer.invoke('pos:users:create', payload); await loadStaff(); closeStaffModal(); toast(id ? 'Đã cập nhật nhân viên' : 'Đã tạo nhân viên'); } catch (error) { toast(`Lưu nhân viên thất bại: ${error.message}`); } }
function renderProducts(query = '') { const grid = document.getElementById('productGrid'); if (!grid) return; grid.innerHTML = ''; const q = query.toLowerCase(); products.filter((p) => (selectedCategory === 'all' || p.category_id === selectedCategory) && (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))).forEach((p) => { const card = document.createElement('div'); card.className = 'product-card'; card.onclick = () => addToOrder(p); const image = p.image_url ? `<img src="${p.image_url}" alt="${p.name}" onerror="this.remove();this.nextElementSibling.style.display='grid'">` : ''; card.innerHTML = `<div class="product-img-wrap">${image}<i class="fa-solid fa-utensils product-fallback-icon"></i></div><div class="product-title">${p.name}</div><div class="product-price">${money(p.selling_price)}</div><span class="product-badge">${p.id}</span>`; if (p.image_url) card.querySelector('.product-fallback-icon').style.display = 'none'; grid.appendChild(card); }); }
async function selectTable(table) { try { currentOrder = await ipcRenderer.invoke('pos:order:open', table.id); document.getElementById('currentTableDisplay').innerText = `${table.name} (${table.area_name})`; renderOrderTable(); document.querySelector('[data-view="pos-view"]')?.click(); } catch (error) { toast(error.message); } }
async function openTableTransferModal() {
	if (!currentOrder) return toast('Chưa có đơn để chuyển hoặc gộp bàn');
	try { tables = await ipcRenderer.invoke('pos:tables'); openTableOperationModal(currentOrder.id, 'MOVE'); } catch (error) { toast(`Không tải được sơ đồ bàn: ${error.message}`); }
}
let orderMutationInFlight = false;
async function addToOrder(product) {
  if (orderMutationInFlight) return;
  orderMutationInFlight = true;
  try {
    if (!currentSession) return toast('Vui lòng đăng nhập trước khi thêm món.');
    if (!currentOrder || currentOrder.status !== 'SERVING') {
      // Bán mang đi khi chưa chọn bàn hoặc đơn vừa thanh toán/hủy
      currentOrder = await ipcRenderer.invoke('pos:order:open', null);
      if (!currentOrder?.id) throw new Error('Không tạo được đơn bán hàng mang đi.');
      document.getElementById('currentTableDisplay').innerText = 'Đơn mang đi';
    }
    const quantity = product.is_weighted ? 0.5 : 1;
    const note = '';
    currentOrder = await ipcRenderer.invoke('pos:order:add-item', currentOrder.id, product.id, quantity, note);
    renderOrderTable();
  } catch (error) {
    const message = String(error?.message || error);
    toast(`Không thể thêm món: ${message}`);
  } finally {
    orderMutationInFlight = false;
  }
}
async function loginWithPassword(username, password) { currentSession = await ipcRenderer.invoke('pos:auth:login', username, password); return currentSession; }
async function loginWithPin(pin) { currentSession = await ipcRenderer.invoke('pos:auth:pin', pin, document.getElementById('loginUserSelect')?.value || null); return currentSession; }
async function logout() { await ipcRenderer.invoke('pos:auth:logout'); currentSession = null; currentOrder = null; updateSessionDisplay(); showLogin(); }
function renderFloorTabs() { const tabs = document.getElementById('floorTabs'); if (!tabs) return; const isAdmin = currentSession?.role === 'ADMIN'; tabs.innerHTML = ''; const all = document.createElement('button'); all.className = `floor-tab ${selectedArea === 'all' ? 'active' : ''}`; all.innerHTML = `<i class="fa-solid fa-border-all"></i> Tất cả (${tables.length})`; all.onclick = () => { selectedArea = 'all'; renderFloorTabs(); renderFloorGrid(); }; tabs.appendChild(all); areas.forEach((area) => { const count = tables.filter((table) => table.area_id === area.id).length; const button = document.createElement('button'); button.draggable = true; button.className = `floor-tab ${selectedArea === area.id ? 'active' : ''}`; button.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${area.name} (${count}) ${isAdmin ? '<span class="area-tab-edit" title="Sửa khu vực"><i class="fa-solid fa-pen"></i></span>' : ''}<span class="area-tab-delete" title="Xóa khu vực"><i class="fa-solid fa-xmark"></i></span>`; button.onclick = () => { selectedArea = area.id; renderFloorTabs(); renderFloorGrid(); }; button.querySelector('.area-tab-edit')?.addEventListener('click', (event) => { event.stopPropagation(); openAreaEditModal(area); }); button.querySelector('.area-tab-delete').onclick = (event) => { event.stopPropagation(); deleteFloorArea(area.id); }; button.addEventListener('dragstart', () => { draggedFloorItem = { kind: 'area', id: area.id }; }); button.addEventListener('dragover', (event) => event.preventDefault()); button.addEventListener('drop', async (event) => { event.preventDefault(); try { await persistFloorOrder('area', draggedFloorItem?.id, area.id); } catch (error) { toast(`Đổi thứ tự khu vực thất bại: ${error.message}`); } draggedFloorItem = null; }); tabs.appendChild(button); }); }
let floorFormMode = { type: null, id: null };
let draggedFloorItem = null;
async function persistFloorOrder(kind, sourceId, targetId) {
  if (sourceId === targetId) return;
  if (kind === 'area') {
    const ids = areas.map((area) => area.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    areas = await ipcRenderer.invoke('pos:areas:reorder', ids);
  } else {
    const areaId = tables.find((table) => table.id === sourceId)?.area_id;
    if (!areaId || areaId !== tables.find((table) => table.id === targetId)?.area_id) return;
    const ids = tables.filter((table) => table.area_id === areaId).map((table) => table.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    tables = await ipcRenderer.invoke('pos:tables:reorder', areaId, ids);
  }
  renderFloorTabs();
  renderFloorGrid();
}
function openAreaModal() { if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được thêm khu vực'); floorFormMode = { type: 'area', id: null }; document.getElementById('floorModalTitle').innerHTML = '<i class="fa-solid fa-layer-group"></i> Thêm khu vực'; document.getElementById('floorNameLabel').innerText = 'Tên khu vực'; document.getElementById('floorNameInput').value = ''; document.getElementById('floorAreaNameGroup').hidden = false; document.getElementById('floorAreaSelectGroup').hidden = true; document.getElementById('floorAreaSelect').disabled = true; document.getElementById('floorModalOverlay').style.display = 'flex'; document.getElementById('floorNameInput').focus(); }
function openAreaEditModal(area) { if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được sửa khu vực'); floorFormMode = { type: 'area', id: area.id }; document.getElementById('floorModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Sửa khu vực'; document.getElementById('floorNameLabel').innerText = 'Tên khu vực'; document.getElementById('floorNameInput').value = area.name; document.getElementById('floorAreaNameGroup').hidden = false; document.getElementById('floorAreaSelectGroup').hidden = true; document.getElementById('floorAreaSelect').disabled = true; document.getElementById('floorModalOverlay').style.display = 'flex'; document.getElementById('floorNameInput').focus(); }
function openTableModal() { if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được thêm bàn'); if (!areas.length) return toast('Hãy tạo khu vực trước'); const select = document.getElementById('floorAreaSelect'); select.innerHTML = areas.map((area) => `<option value="${area.id}" ${area.id === selectedArea ? 'selected' : ''}>${area.name}</option>`).join(''); floorFormMode = { type: 'table', id: null }; document.getElementById('floorModalTitle').innerHTML = '<i class="fa-solid fa-table-cells"></i> Thêm bàn'; document.getElementById('floorNameLabel').innerText = 'Tên bàn'; document.getElementById('floorNameInput').value = ''; document.getElementById('floorAreaNameGroup').hidden = false; document.getElementById('floorAreaSelectGroup').hidden = false; select.disabled = false; document.getElementById('floorModalOverlay').style.display = 'flex'; document.getElementById('floorNameInput').focus(); }
function openTableEditModal(table) { if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được sửa bàn'); const select = document.getElementById('floorAreaSelect'); select.innerHTML = areas.map((area) => `<option value="${area.id}" ${area.id === table.area_id ? 'selected' : ''}>${area.name}</option>`).join(''); floorFormMode = { type: 'table', id: table.id }; document.getElementById('floorModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Sửa bàn'; document.getElementById('floorNameLabel').innerText = 'Tên bàn'; document.getElementById('floorNameInput').value = table.name; document.getElementById('floorAreaNameGroup').hidden = false; document.getElementById('floorAreaSelectGroup').hidden = false; select.disabled = false; document.getElementById('floorModalOverlay').style.display = 'flex'; document.getElementById('floorNameInput').focus(); }
function closeFloorModal() { document.getElementById('floorModalOverlay').style.display = 'none'; floorFormMode = { type: null, id: null }; }
async function saveFloorForm(event) { event.preventDefault(); if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được quản lý sơ đồ bàn'); const name = document.getElementById('floorNameInput').value.trim(); if (!name) return toast('Vui lòng nhập tên.'); try { if (floorFormMode.type === 'area') { if (floorFormMode.id) { await ipcRenderer.invoke('pos:areas:update', floorFormMode.id, { name }); toast(`Đã đổi tên khu vực thành ${name}`); } else { const area = await ipcRenderer.invoke('pos:areas:create', { name, sort_order: areas.length + 1 }); selectedArea = area.id; toast(`Đã thêm khu vực ${name}`); } areas = await ipcRenderer.invoke('pos:areas:list'); } else if (floorFormMode.type === 'table') { const areaId = document.getElementById('floorAreaSelect').value; if (!areaId) return toast('Vui lòng chọn khu vực.'); if (floorFormMode.id) { await ipcRenderer.invoke('pos:tables:update', floorFormMode.id, { area_id: areaId, name }); toast(`Đã đổi tên bàn thành ${name}`); } else { await ipcRenderer.invoke('pos:tables:create', { area_id: areaId, name }); toast(`Đã thêm bàn ${name}`); } selectedArea = areaId; tables = await ipcRenderer.invoke('pos:tables'); } closeFloorModal(); renderFloorTabs(); renderFloorGrid(); } catch (error) { toast(`Lưu sơ đồ thất bại: ${error.message}`); } }
async function deleteFloorArea(areaId) { if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được xóa khu vực'); const area = areas.find((item) => item.id === areaId); if (!area) return; if (tables.some((table) => table.area_id === areaId && table.status !== 'EMPTY')) return toast('Không thể xóa khu vực vì còn bàn đang phục vụ hoặc có đơn mở.'); try { await ipcRenderer.invoke('pos:areas:delete', areaId); areas = await ipcRenderer.invoke('pos:areas:list'); tables = await ipcRenderer.invoke('pos:tables'); selectedArea = 'all'; renderFloorTabs(); renderFloorGrid(); toast(`Đã xóa khu vực ${area.name} và các bàn trống`); } catch (error) { toast(`Xóa khu vực thất bại: ${error.message}`); } }
async function deleteFloorTable(tableId) { if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được xóa bàn'); const table = tables.find((item) => item.id === tableId); if (!table) return; if (table.status !== 'EMPTY') return toast('Chỉ xóa được bàn đang trống'); try { await ipcRenderer.invoke('pos:tables:delete', tableId); tables = await ipcRenderer.invoke('pos:tables'); renderFloorTabs(); renderFloorGrid(); toast(`Đã xóa bàn ${table.name}`); } catch (error) { toast(`Xóa bàn thất bại: ${error.message}`); } }
let tableOperation = { mode: null, orderId: null };
function openTableOperationModal(orderId, mode) { if (!['MOVE', 'MERGE'].includes(mode)) return; const source = tables.find((table) => table.active_order_id === orderId); if (!source) return toast('Không tìm thấy đơn đang phục vụ của bàn này'); const targets = tables.filter((table) => table.id !== source.id && (mode === 'MOVE' ? table.status === 'EMPTY' : table.status === 'OCCUPIED' && table.active_order_id)); if (!targets.length) return toast(mode === 'MOVE' ? 'Không có bàn trống để chuyển' : 'Không có bàn đang phục vụ để gộp'); tableOperation = { mode, orderId }; document.getElementById('tableOperationTitle').innerHTML = mode === 'MOVE' ? '<i class="fa-solid fa-right-left"></i> Chuyển bàn' : '<i class="fa-solid fa-object-group"></i> Gộp bàn'; document.getElementById('tableOperationHint').innerText = `${mode === 'MOVE' ? 'Chuyển đơn' : 'Gộp đơn'} từ ${source.name}`; document.getElementById('tableOperationTarget').innerHTML = targets.map((table) => `<option value="${table.id}">${table.name} - ${table.area_name}</option>`).join(''); document.getElementById('tableOperationOverlay').style.display = 'flex'; }
function closeTableOperationModal() { document.getElementById('tableOperationOverlay').style.display = 'none'; tableOperation = { mode: null, orderId: null }; }
async function submitTableOperation() { const targetId = document.getElementById('tableOperationTarget').value; if (!tableOperation.orderId || !targetId) return; const operation = { ...tableOperation }; try { tables = await ipcRenderer.invoke('pos:tables'); const target = tables.find((table) => table.id === targetId); if (!target) throw new Error('Không tìm thấy bàn đích.'); const result = operation.mode === 'MOVE' ? await ipcRenderer.invoke('pos:order:move-table', operation.orderId, targetId) : await ipcRenderer.invoke('pos:order:merge-tables', operation.orderId, target.active_order_id); closeTableOperationModal(); tables = await ipcRenderer.invoke('pos:tables'); renderFloorTabs(); renderFloorGrid(); if (currentOrder?.id === operation.orderId || currentOrder?.id === target.active_order_id) { currentOrder = result; document.getElementById('currentTableDisplay').innerText = currentOrder.table_name || 'Đơn mang đi'; renderOrderTable(); } toast(operation.mode === 'MOVE' ? `Đã chuyển bàn sang ${target.name}` : `Đã gộp bàn vào ${target.name}`); } catch (error) { toast(`Thao tác bàn thất bại: ${error.message}`); } }
function renderOrderTable() {
  const body = document.getElementById('orderTableBody');
  const emptyBox = document.getElementById('emptyCartIllustration');
  const orderTable = document.getElementById('orderTable');
  if (!body) return;

  body.innerHTML = '';
  const details = currentOrder?.details || [];

  if (details.length === 0) {
    if (emptyBox) emptyBox.style.display = 'flex';
    if (orderTable) orderTable.style.display = 'none';
    return updateTotals(0);
  }

  if (emptyBox) emptyBox.style.display = 'none';
  if (orderTable) orderTable.style.display = 'table';

  details.forEach((item) => {
    const row = document.createElement('tr');
    const locked = Boolean(item.is_printed_kitchen);
    row.innerHTML = `<td><strong>${item.product_name}</strong><small>${locked ? 'Đã gửi bếp' : 'Mới thêm'}${item.note ? ` • ${item.note}` : ''}</small></td><td><div class="qty-control"><button class="qty-btn" ${locked ? 'disabled' : ''} onclick="updateQty('${item.id}',-1)">-</button><span>${item.quantity}</span><button class="qty-btn" ${locked ? 'disabled' : ''} onclick="updateQty('${item.id}',1)">+</button></div></td><td>${money(item.price)}</td><td><strong>${money(item.amount)}</strong></td><td><button class="delete-item-btn" onclick="removeOrderDetail('${item.id}',${locked})"><i class="fa-solid ${locked ? 'fa-lock' : 'fa-xmark'}"></i></button></td>`;
    body.appendChild(row);
  });
  updateTotals(currentOrder.grand_total, currentOrder.subtotal, currentOrder.vat_amount);
}
function updateTotals(total, subtotal = 0, vat = 0) { document.getElementById('subTotal').innerText = money(subtotal); document.getElementById('vatVal').innerText = money(vat); document.getElementById('grandTotal').innerText = money(total); }
function inventoryProducts() { const query = (document.getElementById('invSearchInput')?.value || '').toLowerCase().trim(); const category = document.getElementById('invCategoryFilter')?.value || 'all'; const stock = document.getElementById('invStockFilter')?.value || 'all'; return products.filter((product) => { const matchesText = !query || product.id.toLowerCase().includes(query) || product.name.toLowerCase().includes(query); const matchesCategory = category === 'all' || product.category_id === category; const matchesStock = stock === 'all' || (stock === 'out' && Number(product.stock_quantity) <= 0) || (stock === 'low' && Number(product.stock_quantity) > 0 && Number(product.stock_quantity) <= Number(product.min_stock_quantity || 5)); return matchesText && matchesCategory && matchesStock; }); }
function renderInventory() { const body = document.getElementById('inventoryModernTableBody'); if (!body) return; const isAdmin = currentSession?.role === 'ADMIN'; const low = products.filter((product) => Number(product.stock_quantity) > 0 && Number(product.stock_quantity) <= Number(product.min_stock_quantity || 5)); const out = products.filter((product) => Number(product.stock_quantity) <= 0); document.getElementById('metricTotalItems').innerText = `${products.length} món`; document.getElementById('metricStockValue').innerText = money(products.reduce((total, product) => total + Number(product.cost_price || 0) * Number(product.stock_quantity || 0), 0)); document.getElementById('metricLowStock').innerText = `${low.length} món`; document.getElementById('metricOutStock').innerText = `${out.length} món`; const visible = inventoryProducts(); body.innerHTML = ''; visible.forEach((product) => { const stockValue = Number(product.stock_quantity || 0); const minStock = Number(product.min_stock_quantity || 5); const percent = Math.min(100, minStock > 0 ? (stockValue / Math.max(minStock * 3, 1)) * 100 : stockValue > 0 ? 100 : 0); const status = stockValue <= 0 ? ['Hết hàng', 'out-stock'] : stockValue <= minStock ? ['Sắp hết', 'low-stock'] : ['Còn hàng', 'in-stock']; const image = product.image_url ? `<img class="prod-thumb" src="${product.image_url}" alt="${product.name}" onerror="this.style.visibility='hidden'">` : '<span class="prod-thumb product-thumb-fallback"><i class="fa-solid fa-image"></i></span>'; const row = document.createElement('tr'); const editAction = isAdmin ? `<button class="action-icon-btn" title="Sửa" onclick="openProductDrawer('${product.id}')"><i class="fa-solid fa-pen"></i></button>` : ''; row.innerHTML = `<td class="center-col">${image}</td><td><div class="prod-info-cell"><span class="prod-cell-name">${product.name}</span><span class="prod-cell-code">${product.id}</span></div></td><td>${product.category_name || product.category_id}</td><td>${product.unit}</td><td class="right-col">${money(product.cost_price)}</td><td class="right-col">${money(product.selling_price)}</td><td><div class="stock-cell-wrap"><div class="stock-val-row"><span>${stockValue}</span><small>${product.unit}</small></div><div class="stock-bar-bg"><div class="stock-bar-fill ${status[1]}" style="width:${percent}%"></div></div></div></td><td><span class="status-pill ${status[1]}">${status[0]}</span></td><td class="center-col"><button class="action-icon-btn" title="Định lượng" onclick="openRecipeDialog('${product.id}')"><i class="fa-solid fa-flask"></i></button>${editAction}<button class="action-icon-btn delete" title="Xóa" onclick="deleteProduct('${product.id}')"><i class="fa-solid fa-trash"></i></button></td>`; body.appendChild(row); }); document.getElementById('inventoryPageInfo').innerText = `${visible.length} / ${products.length} mặt hàng`; updateRoleBasedUi(); }
function resetProductForm() { document.getElementById('productForm')?.reset(); document.getElementById('prodCode').value = ''; document.getElementById('prodCode').disabled = false; }
function resetDrawerProductForm() { document.getElementById('drawerProductForm')?.reset(); document.getElementById('drawerProdCode').disabled = false; document.getElementById('drawerProdImgUrl').value = ''; document.getElementById('imgPreviewBox').innerHTML = '<i class="fa-regular fa-image"></i>'; }
function updateUrlPreview(url) { const box = document.getElementById('imgPreviewBox'); if (!box) return; box.innerHTML = url ? `<img src="${url}" alt="Ảnh sản phẩm" onerror="this.parentElement.innerHTML='<i class=\'fa-regular fa-image\'></i>'">` : '<i class="fa-regular fa-image"></i>'; }
function openProductDrawer(id = null) { resetDrawerProductForm(); const product = id ? products.find((item) => item.id === id) : null; document.getElementById('drawerTitle').innerHTML = `<i class="fa-solid fa-box-open"></i> ${product ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}`; if (product) { document.getElementById('drawerProdCode').value = product.id; document.getElementById('drawerProdCode').disabled = true; document.getElementById('drawerProdUnit').value = product.unit; document.getElementById('drawerProdName').value = product.name; document.getElementById('drawerProdCat').value = product.category_id; document.getElementById('drawerProdCost').value = product.cost_price; document.getElementById('drawerProdPrice').value = product.selling_price; document.getElementById('drawerProdStock').value = product.stock_quantity; document.getElementById('drawerProdMinStock').value = product.min_stock_quantity || 5; document.getElementById('drawerProdImgUrl').value = product.image_url || ''; updateUrlPreview(product.image_url || ''); } document.getElementById('productDrawerOverlay').style.display = 'block'; document.getElementById('productDrawer').classList.add('open'); }
function closeProductDrawer() { document.getElementById('productDrawer').classList.remove('open'); document.getElementById('productDrawerOverlay').style.display = 'none'; }
async function uploadDrawerProductImage() { try { const result = await ipcRenderer.invoke('pos:products:upload-image'); if (!result.canceled) { document.getElementById('drawerProdImgUrl').value = result.imageUrl; updateUrlPreview(result.imageUrl); } } catch (error) { toast(`Tải ảnh thất bại: ${error.message}`); } }
async function handleDrawerSaveProduct(event) { event.preventDefault(); try { const id = document.getElementById('drawerProdCode').value.trim(); const payload = { id, name: document.getElementById('drawerProdName').value.trim(), category_id: document.getElementById('drawerProdCat').value, unit: document.getElementById('drawerProdUnit').value.trim(), cost_price: Number(document.getElementById('drawerProdCost').value), selling_price: Number(document.getElementById('drawerProdPrice').value), stock_quantity: Number(document.getElementById('drawerProdStock').value), min_stock_quantity: Number(document.getElementById('drawerProdMinStock').value), image_url: document.getElementById('drawerProdImgUrl').value.trim(), is_weighted: 0, status: 'ACTIVE' }; const existing = products.find((product) => product.id === id); if (existing) await ipcRenderer.invoke('pos:products:update', id, payload); else await ipcRenderer.invoke('pos:products:create', payload); products = await ipcRenderer.invoke('pos:products'); renderProducts(document.getElementById('searchInput')?.value || ''); renderInventory(); closeProductDrawer(); toast(existing ? 'Đã cập nhật sản phẩm' : 'Đã thêm sản phẩm'); } catch (error) { toast(`Lưu sản phẩm thất bại: ${error.message}`); } }
function resetProductForm() { document.getElementById('productForm')?.reset(); document.getElementById('prodCode').value = ''; document.getElementById('prodCode').disabled = false; }
function productFormPayload() { return { id: document.getElementById('prodCode').value.trim(), name: document.getElementById('prodName').value.trim(), category_id: document.getElementById('prodCategory').value, unit: document.getElementById('prodUnit').value.trim(), cost_price: Number(document.getElementById('prodCost').value), selling_price: Number(document.getElementById('prodPrice').value), stock_quantity: Number(document.getElementById('prodStock').value), image_url: document.getElementById('prodImage').value.trim(), is_weighted: 0, status: 'ACTIVE' }; }
async function uploadProductImage() { try { const result = await ipcRenderer.invoke('pos:products:upload-image'); if (result.canceled) return; document.getElementById('prodImage').value = result.imageUrl; document.getElementById('prodImagePreview').src = result.imageUrl; toast('Đã tải ảnh lên máy'); } catch (error) { toast(`Tải ảnh thất bại: ${error.message}`); } }
async function handleSaveProduct(event) { event.preventDefault(); try { const payload = productFormPayload(); const existing = products.find((product) => product.id === payload.id); if (existing) await ipcRenderer.invoke('pos:products:update', payload.id, payload); else await ipcRenderer.invoke('pos:products:create', payload); products = await ipcRenderer.invoke('pos:products'); renderProducts(document.getElementById('searchInput')?.value || ''); renderInventory(); resetProductForm(); toast(existing ? 'Đã cập nhật mặt hàng' : 'Đã thêm mặt hàng'); } catch (error) { toast(`Lưu mặt hàng thất bại: ${error.message}`); } }
function editProduct(id) { openProductDrawer(id); }
async function deleteProduct(id) { if (!window.confirm('Xóa mặt hàng này?')) return; try { await ipcRenderer.invoke('pos:products:delete', id); products = await ipcRenderer.invoke('pos:products'); renderProducts(document.getElementById('searchInput')?.value || ''); renderInventory(); toast('Đã xóa mặt hàng'); } catch (error) { toast(`Xóa mặt hàng thất bại: ${error.message}`); } }
async function cancelCurrentOrder() { if (!currentOrder) return toast('Chưa có đơn để hủy'); if (!window.confirm('Hủy đơn hiện tại?')) return; try { await ipcRenderer.invoke('pos:order:cancel', currentOrder.id); currentOrder = null; document.getElementById('currentTableDisplay').innerText = 'Chưa chọn bàn'; tables = await ipcRenderer.invoke('pos:tables'); renderFloorGrid(); renderOrderTable(); toast('Đã hủy đơn'); } catch (error) { toast(`Hủy đơn thất bại: ${error.message}`); } }
async function updateQty(detailId, delta) { try { const detail = currentOrder.details.find((item) => item.id === detailId); currentOrder = await ipcRenderer.invoke('pos:order:update-detail', detailId, delta === -999 ? 0 : detail.quantity + delta); renderOrderTable(); } catch (error) { toast(error.message); } }
async function removeOrderDetail(detailId, locked) { try { currentOrder = locked ? await ipcRenderer.invoke('pos:order:cancel-printed-detail', detailId) : await ipcRenderer.invoke('pos:order:update-detail', detailId, 0); renderOrderTable(); if (locked) toast('Admin đã hủy món đã gửi bếp'); } catch (error) { toast(error.message); } }
async function sendToKitchen() { if (!currentOrder) return toast('Chưa có đơn để gửi bếp'); try { currentOrder = await ipcRenderer.invoke('pos:order:send-kitchen', currentOrder.id); renderOrderTable(); toast('Đã gửi Bếp/Bar'); } catch (error) { toast(error.message); } }
function renderFloorGrid() { const grid = document.getElementById('floorGrid'); if (!grid) return; const isAdmin = currentSession?.role === 'ADMIN'; const counts = { EMPTY: 0, OCCUPIED: 0, WAITING_PAYMENT: 0, RESERVED: 0 }; tables.forEach((table) => { counts[table.status] = (counts[table.status] || 0) + 1; }); ['empty', 'occupied', 'waiting', 'reserved'].forEach((key, index) => { const element = document.getElementById(`${key}TableCount`); if (element) element.innerText = counts[['EMPTY', 'OCCUPIED', 'WAITING_PAYMENT', 'RESERVED'][index]] || 0; }); grid.innerHTML = ''; tables.filter((table) => selectedArea === 'all' || table.area_id === selectedArea).forEach((t) => { const status = { EMPTY: ['Trống', 'st-empty'], OCCUPIED: ['Có khách', 'st-occupied'], WAITING_PAYMENT: ['Chờ thanh toán', 'st-waiting'], RESERVED: ['Đặt trước', 'st-reserved'] }[t.status] || [t.status.toLowerCase(), 'st-empty']; const card = document.createElement('div'); card.draggable = true; card.className = `modern-table-card ${status[1]}`; card.onclick = () => selectTable(t); const elapsed = t.check_in_time ? formatElapsed(t.check_in_time) : ''; const actions = `${isAdmin ? '<button class="tbl-action-btn table-edit-action" title="Sửa bàn"><i class="fa-solid fa-pen"></i></button>' : ''}${t.status === 'EMPTY' ? '<button class="tbl-action-btn table-delete-action" title="Xóa bàn"><i class="fa-solid fa-trash"></i></button>' : t.active_order_id ? '<button class="tbl-action-btn table-move-action" title="Chuyển bàn"><i class="fa-solid fa-right-left"></i></button><button class="tbl-action-btn table-merge-action" title="Gộp bàn"><i class="fa-solid fa-object-group"></i></button>' : ''}`; card.innerHTML = `<div class="tbl-card-top"><div class="tbl-title-group"><span class="tbl-card-title">${t.name}</span><span class="tbl-card-sub">${t.area_name}</span></div><span class="tbl-status-pill">${status[0]}</span></div><div class="tbl-card-mid"><span class="tbl-meta-item"><i class="fa-regular fa-clock"></i> ${elapsed || 'Sẵn sàng'}</span><span class="tbl-meta-item"><i class="fa-solid fa-user-group"></i> ${t.current_guest_count || 0}</span></div><div class="tbl-card-bottom"><span class="tbl-price-tag">${t.active_order_id ? money(t.active_order_total) : 'Trống'}</span><span class="tbl-quick-actions">${actions}</span></div>`; card.querySelectorAll('.tbl-action-btn').forEach((button) => button.addEventListener('click', (event) => event.stopPropagation())); card.querySelector('.table-edit-action')?.addEventListener('click', () => openTableEditModal(t)); card.querySelector('.table-delete-action')?.addEventListener('click', () => deleteFloorTable(t.id)); card.querySelector('.table-move-action')?.addEventListener('click', () => openTableOperationModal(t.active_order_id, 'MOVE')); card.querySelector('.table-merge-action')?.addEventListener('click', () => openTableOperationModal(t.active_order_id, 'MERGE')); card.addEventListener('dragstart', () => { draggedFloorItem = { kind: 'table', id: t.id }; }); card.addEventListener('dragover', (event) => event.preventDefault()); card.addEventListener('drop', async (event) => { event.preventDefault(); try { await persistFloorOrder('table', draggedFloorItem?.id, t.id); } catch (error) { toast(`Đổi thứ tự bàn thất bại: ${error.message}`); } draggedFloorItem = null; }); grid.appendChild(card); }); }
function formatElapsed(start) { const minutes = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
async function openPaymentModal() { if (!currentOrder) return toast('Chưa có đơn để thanh toán'); document.getElementById('payAmountDisplay').innerText = money(currentOrder.grand_total); document.getElementById('payModalTable').innerText = currentOrder.table_name || 'Đơn mang đi'; document.getElementById('cashGiven').value = ''; document.getElementById('paymentRedeemPoints').value = 0; const searchInput = document.getElementById('paymentCustomerSearch'); if (searchInput) searchInput.value = ''; await loadPaymentCustomers(); calcChange(); try { const qr = await ipcRenderer.invoke('pos:checkout:qr', currentOrder.id); document.getElementById('vietQrImage').src = qr.dataUrl; } catch (error) { toast(`Không tạo được VietQR: ${error.message}`); } document.getElementById('paymentModal').style.display = 'flex'; }
function closePaymentModal() { document.getElementById('paymentModal').style.display = 'none'; }
function calcChange() { const paid = Number(document.getElementById('cashGiven')?.value || 0); const total = Number(currentOrder?.grand_total || 0); const change = Math.max(0, paid - total); const target = document.getElementById('changeDisplay'); if (target) target.innerText = money(change); }
function setCash(value) { document.getElementById('cashGiven').value = Number(value); calcChange(); }
function setExactCash() { setCash(currentOrder?.grand_total || 0); }
async function completePayment() {
  if (!currentOrder) return;
  const active = document.querySelector('.pay-method-btn.active');
  const selected = active?.dataset.method;
  const method = selected === 'vietqr' ? 'VIETQR' : selected === 'card' ? 'CARD' : selected === 'credit' ? 'CREDIT' : 'CASH';
  const paid = method === 'CASH' ? Number(document.getElementById('cashGiven')?.value || currentOrder.grand_total) : currentOrder.grand_total;
  const customerId = document.getElementById('paymentCustomerSelect')?.value || null;
  const redeemPoints = Number(document.getElementById('paymentRedeemPoints')?.value || 0);

  if (method === 'CREDIT' && (!customerId || customerId === '' || customerId === 'customer-walk-in')) {
    return toast('Thanh toán ghi nợ bắt buộc phải chọn khách hàng cụ thể (không được để khách vãng lai).');
  }

  try {
    if (method === 'VIETQR') await ipcRenderer.invoke('pos:checkout:qr', currentOrder.id);
    await ipcRenderer.invoke('pos:checkout', currentOrder.id, method, paid, document.getElementById('cardTrace')?.value || '', customerId, redeemPoints);
    closePaymentModal();
    const printed = document.getElementById('chkAutoPrint')?.checked ? await processPrintJobs() : 0;
    if (method === 'CASH' && document.getElementById('chkOpenDrawer')?.checked) await openCashDrawer();
    toast(printed ? 'Thanh toán thành công, đã gửi lệnh in' : 'Thanh toán thành công');
    currentOrder = null;
    document.getElementById('currentTableDisplay').innerText = 'Chưa mở bàn';
    renderOrderTable();
    tables = await ipcRenderer.invoke('pos:tables');
    renderFloorGrid();
    await checkTakeawayOrders();
  } catch (error) {
    toast(`Thanh toán thất bại: ${error.message}`);
  }
}
function setupNavigation() { document.querySelectorAll('.tab-btn').forEach((button) => button.addEventListener('click', () => { if (button.dataset.view === 'settings-view' && currentSession?.role !== 'ADMIN') return toast('Bạn không có quyền truy cập Cấu hình.'); document.querySelectorAll('.tab-btn').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.app-view').forEach((view) => view.classList.remove('active-view')); button.classList.add('active'); document.getElementById(button.dataset.view)?.classList.add('active-view'); if (button.dataset.view === 'report-view' && currentSession) loadAnalytics(); })); document.querySelectorAll('.cat-btn').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.cat-btn').forEach((item) => item.classList.remove('active')); button.classList.add('active'); selectedCategory = button.dataset.cat; renderProducts(document.getElementById('searchInput')?.value || ''); })); document.getElementById('floorForm')?.addEventListener('submit', saveFloorForm); document.getElementById('tableOperationSubmit')?.addEventListener('click', submitTableOperation); }
function setupWindowControls() { document.querySelector('.window-controls .win-btn:nth-child(1)')?.addEventListener('click', () => ipcRenderer.invoke('pos:window:minimize')); document.querySelector('.window-controls .win-btn:nth-child(2)')?.addEventListener('click', () => ipcRenderer.invoke('pos:window:toggle-maximize')); document.querySelector('.window-controls .close-btn')?.addEventListener('click', () => ipcRenderer.invoke('pos:window:close')); }
function setupSettingsNavigation() { const buttons = document.querySelectorAll('.config-nav-btn'); const panes = document.querySelectorAll('.config-pane'); const selectPane = (paneId) => { buttons.forEach((button) => button.classList.toggle('active', button.dataset.configPane === paneId)); const matching = [...panes].filter((pane) => pane.id === paneId); panes.forEach((pane) => pane.classList.remove('active')); matching.at(-1)?.classList.add('active'); }; buttons.forEach((button) => button.addEventListener('click', () => selectPane(button.dataset.configPane))); document.getElementById('staffSearchInput')?.addEventListener('input', renderStaff); selectPane('config-general'); }
async function loadCustomers() {
  const body = document.getElementById('customersTableBody'); if (!body) return;
  try {
    const customers = await ipcRenderer.invoke('pos:customers:list', document.getElementById('customerSearchInput')?.value || '');
    const tier = document.getElementById('customerTierFilter')?.value || 'ALL';
    const debt = document.getElementById('customerDebtFilter')?.value || 'ALL';
    const filtered = customers.filter((c) => (tier === 'ALL' || c.tier === tier) && (debt === 'ALL' || (debt === 'DEBT' ? Number(c.credit_balance) > 0 : Number(c.credit_balance) <= 0)));
    const totalDebt = customers.reduce((sum, c) => sum + Number(c.credit_balance || 0), 0);
    document.getElementById('customerStatTotal').innerText = customers.length.toLocaleString('vi-VN');
    document.getElementById('customerStatNew').innerText = customers.filter((c) => c.id !== 'customer-walk-in' && c.created_at?.slice(0, 7) === new Date().toISOString().slice(0, 7)).length.toLocaleString('vi-VN');
    document.getElementById('customerStatVip').innerText = customers.filter((c) => ['GOLD', 'PLATINUM'].includes(c.tier)).length.toLocaleString('vi-VN');
    document.getElementById('customerStatDebt').innerText = money(totalDebt);
    document.getElementById('customerShowingCount').innerText = filtered.length.toLocaleString('vi-VN');
    document.getElementById('customerTotalCount').innerText = customers.length.toLocaleString('vi-VN');
    body.innerHTML = filtered.map((c) => `<tr><td><strong>${c.code}</strong></td><td><strong>${c.full_name}</strong></td><td>${c.phone || '—'}</td><td><span class="customer-tier-badge tier-${String(c.tier).toLowerCase()}">${c.tier}</span></td><td class="right-col customer-points">${Number(c.points).toLocaleString('vi-VN')}</td><td class="right-col ${Number(c.credit_balance) > 0 ? 'customer-debt' : ''}">${money(c.credit_balance)}</td><td>${c.updated_at ? new Date(c.updated_at).toLocaleDateString('vi-VN') : '—'}</td><td class="center-col"><button class="customer-icon-btn" title="Xem lịch sử" onclick="toast('Mã khách hàng: ${c.code}')"><i class="fa-solid fa-clock-rotate-left"></i></button></td></tr>`).join('');
  } catch (error) { toast(error.message); }
}
function openStockReceipt() {
  document.getElementById('receiptItems').innerHTML = '<div class="receipt-item-row"><div class="form-group"><label>Hàng hóa</label><select class="receipt-product" required></select></div><div class="form-group"><label>Số lượng</label><input class="receipt-quantity" type="number" min="0.001" step="0.001" required></div><div class="form-group"><label>Đơn giá</label><input class="receipt-cost" type="number" min="0" step="1"></div></div>';
  populateReceiptProducts();
  document.getElementById('receiptSupplier').value = '';
  document.getElementById('receiptReference').value = '';
  document.getElementById('receiptNote').value = '';
  document.getElementById('stockReceiptDialog').showModal();
}
function populateReceiptProducts() { document.querySelectorAll('.receipt-product').forEach((select) => { select.innerHTML = products.map((product) => `<option value="${product.id}">${product.name} (${product.unit})</option>`).join(''); }); }
function addReceiptItem() { const first = document.querySelector('.receipt-item-row'); const row = first.cloneNode(true); row.querySelector('.receipt-quantity').value = ''; row.querySelector('.receipt-cost').value = ''; document.getElementById('receiptItems').appendChild(row); populateReceiptProducts(); }
let stockDocumentType = 'IN';
let stockEditingDocumentId = null;
function openStockDocument(type) { stockDocumentType = type; openStockReceipt(); document.querySelector('#stockReceiptDialog h3').innerText = type === 'IN' ? 'Lập phiếu nhập kho' : 'Lập phiếu xuất kho'; document.querySelector('#stockReceiptDialog .btn-primary').innerText = type === 'IN' ? 'Lưu phiếu nhập' : 'Lưu phiếu xuất'; }
async function loadStockDocuments() {
  try {
    const documents = await ipcRenderer.invoke('pos:inventory:documents');
    const list = document.getElementById('stockDocumentsList');
    if (list) list.innerHTML = documents.slice(0, 20).map((document) => `<div class="stock-document-row"><strong>${document.document_no}</strong><span class="stock-document-type">${document.document_type === 'IN' ? 'Nhập kho' : 'Xuất kho'}</span><span>${new Date(document.created_at).toLocaleString('vi-VN')}<small>${document.item_count || 0} mặt hàng</small></span><strong>${money(document.total_amount)}</strong><span>${document.user_name || 'Không rõ'} </span><div class="stock-document-actions"><button class="btn btn-outline btn-sm" onclick="viewStockDocument('${document.id}')"><i class="fa-solid fa-eye"></i> Chi tiết</button>${currentSession?.role === 'ADMIN' ? `<button class="btn btn-outline btn-sm" onclick="editStockDocument('${document.id}')"><i class="fa-solid fa-pen"></i> Sửa</button><button class="btn btn-danger btn-sm" onclick="deleteStockDocument('${document.id}')"><i class="fa-solid fa-trash"></i> Xóa</button>` : ''}</div></div>`).join('') || '<div>Chưa có phiếu kho.</div>';
  } catch (error) { toast(`Không tải được danh sách phiếu: ${error.message}`); }
}
let stockEntryType = 'IN';
let stockEntryItems = [];
function switchStockTab(type) {
  stockEntryType = type;
  document.querySelectorAll('.stock-movement-tab').forEach((button) => button.classList.toggle('active', button.dataset.stockTab === type));
  document.getElementById('stock-entry-panel').hidden = type === 'LIST';
  document.getElementById('stock-documents-panel').hidden = type !== 'LIST';
  if (type !== 'LIST') {
    document.getElementById('stockEntryTitle').innerText = type === 'IN' ? 'Phiếu nhập kho' : 'Phiếu xuất kho';
    document.querySelector('#stock-entry-panel .btn-primary').innerText = type === 'IN' ? 'Lưu phiếu nhập' : 'Lưu phiếu xuất';
    renderStockEntryProducts();
    renderStockEntryItems();
  }
  async function viewStockDocument(id) {
    try {
      const doc = await ipcRenderer.invoke('pos:inventory:document-detail', id);
      const rows = doc.items.map((item) => `<tr><td>${item.product_name}</td><td>${item.quantity}</td><td>${money(item.unit_cost)}</td><td>${money(item.amount)}</td></tr>`).join('');
      const overlay = document.createElement('div'); overlay.className = 'modal-overlay stock-document-modal-overlay'; overlay.style.display = 'flex'; overlay.innerHTML = `<div class="modal-card stock-document-modal"><div class="modal-header"><h3>${doc.document_type === 'IN' ? 'Chi tiết phiếu nhập' : 'Chi tiết phiếu xuất'}: ${doc.document_no}</h3><button class="close-modal" type="button">&times;</button></div><div class="modal-body"><p>Đối tác/bộ phận: ${doc.partner || '-'} · Người lập: ${doc.user_name || '-'}</p><p>Ghi chú: ${doc.note || '-'}</p><table class="inv-modern-table"><thead><tr><th>Hàng hóa</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${rows}</tbody></table></div></div>`; document.body.appendChild(overlay); overlay.querySelector('.close-modal').onclick = () => overlay.remove();
    } catch (error) { toast(`Không tải được chi tiết phiếu: ${error.message}`); }
  }
  async function editStockDocument(id) {
    if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được sửa phiếu kho.');
    try {
      const doc = await ipcRenderer.invoke('pos:inventory:document-detail', id);
      stockEditingDocumentId = id; stockEntryType = doc.document_type; stockEntryItems = doc.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_cost: item.unit_cost }));
      document.getElementById('stockEntryPartner').value = doc.partner || ''; document.getElementById('stockEntryReference').value = doc.document_no || ''; document.getElementById('stockEntryNote').value = doc.note || ''; switchStockTab(doc.document_type); document.getElementById('stockEntryTitle').innerText = `Sửa ${doc.document_type === 'IN' ? 'phiếu nhập' : 'phiếu xuất'}`; document.querySelector('#stock-entry-panel .btn-primary').innerText = 'Cập nhật phiếu'; renderStockEntryItems();
    } catch (error) { toast(`Không tải được phiếu: ${error.message}`); }
  }
  async function deleteStockDocument(id) {
    if (currentSession?.role !== 'ADMIN') return toast('Chỉ Admin được xóa phiếu kho.');
    if (!window.confirm('Xóa phiếu kho và hoàn tác tồn kho?')) return;
    try { await ipcRenderer.invoke('pos:inventory:document-delete', id); await loadStockDocuments(); products = await ipcRenderer.invoke('pos:products'); renderInventory(); toast('Đã xóa phiếu kho'); } catch (error) { toast(`Xóa phiếu thất bại: ${error.message}`); }
  }
}
function renderStockEntryProducts() {
  const query = (document.getElementById('stockEntrySearch')?.value || '').toLowerCase().trim();
  const list = document.getElementById('stockEntryProducts');
  if (!list) return;
  list.innerHTML = products.filter((product) => !query || `${product.id} ${product.name}`.toLowerCase().includes(query)).map((product) => `<button class="stock-entry-product" onclick="addStockEntryItem('${product.id}')"><span><strong>${product.name}</strong><small>${product.id} · Tồn: ${product.stock_quantity} ${product.unit}</small></span><i class="fa-solid fa-plus"></i></button>`).join('') || '<div class="stock-entry-empty">Không tìm thấy hàng hóa</div>';
}
function addStockEntryItem(productId) {
  const existing = stockEntryItems.find((item) => item.product_id === productId);
  if (existing) existing.quantity += 1;
  else stockEntryItems.push({ product_id: productId, quantity: 1, unit_cost: Number(products.find((product) => product.id === productId)?.cost_price || 0) });
  renderStockEntryItems();
}
function renderStockEntryItems() {
  const container = document.getElementById('stockEntryItems');
  const total = stockEntryItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
  document.getElementById('stockEntryTotal').innerText = money(total);
  if (!stockEntryItems.length) { container.innerHTML = '<div class="stock-entry-empty">Chưa chọn hàng hóa</div>'; return; }
  container.innerHTML = stockEntryItems.map((item, index) => { const product = products.find((entry) => entry.id === item.product_id); return `<div class="stock-entry-item"><div><strong>${product?.name || item.product_id}</strong><small>${product?.unit || ''}</small></div><input type="number" min="0.001" step="0.001" value="${item.quantity}" onchange="updateStockEntryItem(${index},'quantity',this.value)"><input type="number" min="0" step="1" value="${item.unit_cost}" ${stockEntryType === 'OUT' ? 'disabled' : ''} onchange="updateStockEntryItem(${index},'unit_cost',this.value)"><button onclick="removeStockEntryItem(${index})"><i class="fa-solid fa-xmark"></i></button></div>`; }).join('');
}
function updateStockEntryItem(index, key, value) { stockEntryItems[index][key] = Number(value); renderStockEntryItems(); }
function removeStockEntryItem(index) { stockEntryItems.splice(index, 1); renderStockEntryItems(); }
async function submitStockEntry() {
  if (!stockEntryItems.length) return toast('Vui lòng chọn ít nhất một mặt hàng');
  try {
    const payload = { document_type: stockEntryType, document_no: document.getElementById('stockEntryReference').value, partner: document.getElementById('stockEntryPartner').value, note: document.getElementById('stockEntryNote').value, items: stockEntryItems };
    if (stockEditingDocumentId) await ipcRenderer.invoke('pos:inventory:document-update', stockEditingDocumentId, payload); else await ipcRenderer.invoke('pos:inventory:document-create', payload);
    products = await ipcRenderer.invoke('pos:products'); stockEntryItems = []; document.getElementById('stockEntryPartner').value = ''; document.getElementById('stockEntryReference').value = ''; document.getElementById('stockEntryNote').value = ''; renderInventory(); renderStockEntryProducts(); renderStockEntryItems(); toast(stockEntryType === 'IN' ? 'Đã lưu phiếu nhập kho' : 'Đã lưu phiếu xuất kho');
    stockEditingDocumentId = null;
  } catch (error) { toast(`Lưu phiếu thất bại: ${error.message}`); }
}
async function submitStockReceipt(event) {
  event.preventDefault();
  try {
    const items = [...document.querySelectorAll('.receipt-item-row')].map((row) => ({ product_id: row.querySelector('.receipt-product').value, quantity: Number(row.querySelector('.receipt-quantity').value), unit_cost: Number(row.querySelector('.receipt-cost').value || 0) }));
    await ipcRenderer.invoke('pos:inventory:document-create', { document_type: stockDocumentType, document_no: document.getElementById('receiptReference').value, partner: document.getElementById('receiptSupplier').value, note: document.getElementById('receiptNote').value, items });
    document.getElementById('stockReceiptDialog').close();
    products = await ipcRenderer.invoke('pos:products'); renderInventory(); toast(stockDocumentType === 'IN' ? 'Đã nhập kho' : 'Đã xuất kho');
  } catch (error) { toast(`Lưu phiếu thất bại: ${error.message}`); }
}
let recipeProductId = null;
function recipeRowHtml(item = {}) {
  const options = products.filter((product) => product.id !== recipeProductId).map((product) => `<option value="${product.id}" ${product.id === item.ingredient_id ? 'selected' : ''}>${product.name}</option>`).join('');
  return `<div class="form-row recipe-row"><div class="form-group col-6"><select class="recipe-ingredient">${options}</select></div><div class="form-group col-4"><input class="recipe-quantity" type="number" min="0.001" step="0.001" value="${item.quantity || ''}" placeholder="Định lượng"></div><button type="button" class="btn btn-outline btn-sm" onclick="this.closest('.recipe-row').remove()">Xóa</button></div>`;
}
function addRecipeRow(item = {}) { document.getElementById('recipeRows').insertAdjacentHTML('beforeend', recipeRowHtml(item)); }
async function openRecipeDialog(productId) {
  recipeProductId = productId;
  const product = products.find((item) => item.id === productId);
  document.getElementById('recipeTitle').innerText = `Định lượng: ${product?.name || productId}`;
  document.getElementById('recipeRows').innerHTML = '';
  const items = await ipcRenderer.invoke('pos:inventory:recipes', productId);
  items.forEach(addRecipeRow); if (!items.length) addRecipeRow();
  document.getElementById('recipeDialog').showModal();
}
async function submitRecipe(event) {
  event.preventDefault();
  try {
    const items = [...document.querySelectorAll('#recipeRows .recipe-row')].map((row) => ({ ingredient_id: row.querySelector('.recipe-ingredient').value, quantity: Number(row.querySelector('.recipe-quantity').value) }));
    await ipcRenderer.invoke('pos:inventory:recipe-save', recipeProductId, items);
    document.getElementById('recipeDialog').close(); toast('Đã lưu định lượng món');
  } catch (error) { toast(`Lưu định lượng thất bại: ${error.message}`); }
}
function exportCustomers() { toast('Danh sách khách hàng đã sẵn sàng để xuất'); }
function openCustomerModal() { document.getElementById('customerForm')?.reset(); document.getElementById('customerModalOverlay').style.display = 'flex'; document.getElementById('customerName')?.focus(); }
function closeCustomerModal() { document.getElementById('customerModalOverlay').style.display = 'none'; }
async function saveCustomer(event) { event.preventDefault(); try { const customer = await ipcRenderer.invoke('pos:customers:create', { code: document.getElementById('customerCode').value, full_name: document.getElementById('customerName').value, phone: document.getElementById('customerPhone').value, email: document.getElementById('customerEmail').value, credit_limit: Number(document.getElementById('customerCreditLimit').value || 0), notes: document.getElementById('customerNotes').value }); closeCustomerModal(); await loadCustomers(); if (document.getElementById('paymentModal').style.display === 'flex') { await loadPaymentCustomers(); document.getElementById('paymentCustomerSelect').value = customer.id; updatePaymentCustomerSummary(); } toast('Đã thêm khách hàng và chọn cho hóa đơn'); } catch (error) { toast(error.message); } }
async function loadPaymentCustomers() {
  const select = document.getElementById('paymentCustomerSelect');
  const suggestionsBox = document.getElementById('customerSuggestions');
  if (!select) return;
  try {
    const query = document.getElementById('paymentCustomerSearch')?.value || '';
    const customers = await ipcRenderer.invoke('pos:customers:list', query);
    const validCustomers = customers.filter((c) => c.id !== 'customer-walk-in');
    const quickButton = document.getElementById('paymentQuickCreateButton');
    if (quickButton) {
      quickButton.style.display = (query.trim() && validCustomers.length === 0) ? 'inline-block' : 'none';
    }
    const currentVal = select.value;
    select.innerHTML = '<option value="">Khách Vãng Lai</option>' + validCustomers.map((c) => `<option value="${c.id}">${c.full_name} - ${c.phone || c.code}</option>`).join('');
    if (currentVal) select.value = currentVal;

    if (suggestionsBox) {
      if (query.trim() && validCustomers.length > 0) {
        suggestionsBox.style.display = 'block';
        suggestionsBox.innerHTML = validCustomers.map((c) => `
          <div class="customer-suggestion-item" onclick="selectPaymentCustomer('${c.id}', '${encodeURIComponent(c.full_name)}', '${encodeURIComponent(c.phone || '')}')">
            <strong>${c.full_name}</strong>
            <span style="color: #64748b;">${c.phone || c.code}</span>
          </div>
        `).join('');
      } else {
        suggestionsBox.style.display = 'none';
      }
    }
  } catch (error) {
    toast(error.message);
  }
}

function selectPaymentCustomer(id, encodedName, encodedPhone) {
  const select = document.getElementById('paymentCustomerSelect');
  const searchInput = document.getElementById('paymentCustomerSearch');
  const suggestionsBox = document.getElementById('customerSuggestions');
  if (select) {
    select.value = id;
    updatePaymentCustomerSummary();
  }
  if (searchInput) searchInput.value = `${decodeURIComponent(encodedName)} (${decodeURIComponent(encodedPhone)})`;
  if (suggestionsBox) suggestionsBox.style.display = 'none';
}
function openQuickCustomerModal() { const query = document.getElementById('paymentCustomerSearch')?.value.trim() || ''; openCustomerModal(); const isPhone = /^\d[\d\s.+-]{7,}$/.test(query); document.getElementById('customerName').value = isPhone ? '' : query; document.getElementById('customerPhone').value = isPhone ? query : ''; document.getElementById(isPhone ? 'customerName' : 'customerPhone').focus(); }
function updatePaymentCustomerSummary() { const c = document.getElementById('paymentCustomerSelect')?.selectedOptions[0]; const summary = document.getElementById('paymentCustomerSummary'); if (summary) summary.innerText = c?.value ? `Đã chọn: ${c.textContent}` : 'Khách Vãng lai - không tích điểm'; }

function setupShortcuts() { window.addEventListener('keydown', (event) => { if (event.key === 'F1') { event.preventDefault(); document.getElementById('searchInput')?.focus(); } if (event.key === 'F2') { event.preventDefault(); document.querySelector('[data-view="pos-view"]')?.click(); document.getElementById('searchInput')?.focus(); } if (event.key === 'F7') { event.preventDefault(); sendToKitchen(); } if (event.key === 'F8') { event.preventDefault(); printDraftBill(); } if (event.key === 'F9') { event.preventDefault(); openPaymentModal(); } if (event.key === 'F10') { event.preventDefault(); openCashDrawer(); } if (event.key === 'Escape') closePaymentModal(); }); }
function setupSearch() { document.getElementById('searchInput')?.addEventListener('input', (event) => renderProducts(event.target.value)); }
function setupInventory() { ['invSearchInput', 'invCategoryFilter', 'invStockFilter'].forEach((id) => document.getElementById(id)?.addEventListener('input', renderInventory)); document.getElementById('invCategoryFilter')?.addEventListener('change', renderInventory); document.getElementById('invStockFilter')?.addEventListener('change', renderInventory); switchStockTab('IN'); }
function setupAnalytics() { document.querySelectorAll('.analytics-date-btn').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.analytics-date-btn').forEach((item) => item.classList.toggle('active', item === button)); setAnalyticsPreset(button.dataset.days); loadAnalytics(); })); document.getElementById('analyticsOrderSearch')?.addEventListener('input', () => { const from = document.getElementById('analyticsFrom').value; const to = document.getElementById('analyticsTo').value; if (from && to) loadAnalytics(); }); setAnalyticsPreset(0); }
function setupPaymentMethods() { document.querySelectorAll('.pay-method-btn').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.pay-method-btn').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.method-subview').forEach((view) => view.classList.remove('active')); button.classList.add('active'); document.getElementById(`method-${button.dataset.method}`)?.classList.add('active'); })); document.getElementById('paymentCustomerSearch')?.addEventListener('input', loadPaymentCustomers); }
function closeAdminRecoveryModal() { document.getElementById('adminRecoveryOverlay').style.display = 'none'; document.getElementById('adminRecoveryForm')?.reset(); }
async function generateAdminRecoveryCode() { try { const code = await ipcRenderer.invoke('pos:auth:recovery-generate'); const input = document.getElementById('adminRecoveryCode'); if (input) input.value = code; document.getElementById('adminRecoveryOverlay').style.display = 'flex'; input?.focus(); input?.select(); try { await navigator.clipboard?.writeText(code); toast('Đã tạo mã khôi phục và sao chép vào clipboard. Hãy lưu mã ở nơi an toàn.'); } catch (_) { toast('Đã tạo mã khôi phục. Hãy lưu mã ở nơi an toàn.'); } } catch (error) { toast(`Không tạo được mã khôi phục: ${error.message}`); } }
async function resetAdminPassword(event) { event.preventDefault(); try { await ipcRenderer.invoke('pos:auth:recovery-reset', document.getElementById('adminRecoveryCode').value, document.getElementById('adminRecoveryPassword').value); closeAdminRecoveryModal(); toast('Đã đặt lại mật khẩu Admin. Mã khôi phục đã bị vô hiệu hóa.'); } catch (error) { toast(`Khôi phục mật khẩu thất bại: ${error.message}`); } }
function setupAuthentication() { const pinFields = document.getElementById('pinLoginFields'); if (pinFields && !document.getElementById('loginUserSelect')) { const label = document.createElement('label'); label.innerText = 'Chọn nhân viên'; const select = document.createElement('select'); select.id = 'loginUserSelect'; label.appendChild(select); pinFields.prepend(label); ipcRenderer.invoke('pos:auth:users').then((users) => { select.innerHTML = users.filter((user) => user.status === 'ACTIVE').map((user) => `<option value="${user.id}">${user.full_name} - ${roleLabel(user.role)}</option>`).join(''); }).catch((error) => toast(`Không tải được danh sách nhân viên: ${error.message}`)); } const forgot = document.createElement('button'); forgot.type = 'button'; forgot.className = 'btn btn-link login-recovery-link'; forgot.innerText = 'Quên mật khẩu Admin?'; forgot.onclick = () => { document.getElementById('adminRecoveryOverlay').style.display = 'flex'; document.getElementById('adminRecoveryCode')?.focus(); }; document.getElementById('passwordLoginFields')?.appendChild(forgot); const setLoginMode = (mode) => { loginMode = mode; const passwordFields = document.getElementById('passwordLoginFields'); const passwordInputs = passwordFields?.querySelectorAll('input') || []; const pinInput = document.getElementById('loginPin'); document.querySelectorAll('.login-tab').forEach((item) => item.classList.toggle('active', item.dataset.loginMode === mode)); if (passwordFields) passwordFields.hidden = mode !== 'password'; if (pinFields) pinFields.hidden = mode !== 'pin'; passwordInputs.forEach((input) => { input.disabled = mode !== 'password'; }); if (pinInput) pinInput.disabled = mode !== 'pin'; }; document.querySelectorAll('.login-tab').forEach((button) => button.addEventListener('click', () => setLoginMode(button.dataset.loginMode))); setLoginMode('password'); document.getElementById('adminRecoveryForm')?.addEventListener('submit', resetAdminPassword); document.getElementById('loginForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { currentSession = loginMode === 'pin' ? await loginWithPin(document.getElementById('loginPin').value) : await loginWithPassword(document.getElementById('loginUsername').value, document.getElementById('loginPassword').value); await loadApplication(); } catch (error) { clearLoginPin(); const message = error?.message || ''; const isLicenseError = /license|bản quyền|thu hồi|kích hoạt/i.test(message); toast(isLicenseError ? message : (loginMode === 'pin' ? 'PIN không đúng' : 'Tên đăng nhập hoặc mật khẩu không đúng'), 'Thông báo'); } }); document.getElementById('logoutBtn')?.addEventListener('click', logout); document.getElementById('staffForm')?.addEventListener('submit', saveStaff); document.getElementById('credentialsForm')?.addEventListener('submit', saveCredentials); document.getElementById('userProfileButton')?.addEventListener('click', openCredentialsModal); document.getElementById('userProfileButton')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCredentialsModal(); } }); }
async function processPrintJobs() { try { const result = await ipcRenderer.invoke('pos:print:process'); return result.filter((job) => job.status === 'DONE').length; } catch (error) { toast(`Máy in chưa sẵn sàng: ${error.message}`); return 0; } }
async function confirmVietQrPaid() {
  if (!currentOrder) return;
  const customerId = document.getElementById('paymentCustomerSelect')?.value || null;
  const redeemPoints = Number(document.getElementById('paymentRedeemPoints')?.value || 0);
  try {
    await ipcRenderer.invoke('pos:checkout', currentOrder.id, 'VIETQR', currentOrder.grand_total, 'QR-TRANSFER', customerId, redeemPoints);
    closePaymentModal();
    const printed = document.getElementById('chkAutoPrint')?.checked ? await processPrintJobs() : 0;
    if (document.getElementById('chkOpenDrawer')?.checked) await openCashDrawer();
    toast(printed ? 'Xác nhận VietQR thành công, đã gửi lệnh in' : 'Xác nhận VietQR thành công');
    currentOrder = null;
    document.getElementById('currentTableDisplay').innerText = 'Chưa mở bàn';
    renderOrderTable();
    tables = await ipcRenderer.invoke('pos:tables');
    renderFloorGrid();
    await checkTakeawayOrders();
  } catch (error) {
    toast(`Xác nhận VietQR thất bại: ${error.message}`);
  }
}
async function openCashDrawer() { try { await ipcRenderer.invoke('pos:drawer:open'); const printed = await processPrintJobs(); toast(printed ? 'Đã gửi lệnh mở két' : 'Lệnh mở két đang chờ máy in'); } catch (error) { toast(error.message); } }
async function importProductsExcel() {
	try {
		const result = await ipcRenderer.invoke('pos:products:import');
		if (result.canceled) return;
		products = await ipcRenderer.invoke('pos:products');
		renderProducts(document.getElementById('searchInput')?.value || '');
		toast(`Đã nhập ${result.imported} mặt hàng từ Excel`);
	} catch (error) { toast(`Nhập Excel thất bại: ${error.message}`); }
}
async function exportProductsExcel() {
	try {
		const result = await ipcRenderer.invoke('pos:products:export');
		if (!result.canceled) toast(`Đã xuất Excel: ${result.file}`);
	} catch (error) { toast(`Xuất Excel thất bại: ${error.message}`); }
}
function ensureReportPrintControls() { const toolbar = document.querySelector('#report-view .analytics-filter-toolbar'); if (!toolbar || document.getElementById('reportPrintButtons')) return; const group = document.createElement('div'); group.id = 'reportPrintButtons'; group.className = 'report-print-buttons'; group.innerHTML = '<button class="btn btn-outline" onclick="openAnalyticsReport(\'REVENUE\')"><i class="fa-solid fa-chart-line"></i> Xem Doanh thu</button><button class="btn btn-outline" onclick="openAnalyticsReport(\'INVENTORY\')"><i class="fa-solid fa-boxes-stacked"></i> Xem tồn kho</button><button class="btn btn-outline" onclick="openAnalyticsReport(\'DEBT\')"><i class="fa-solid fa-file-invoice-dollar"></i> Xem công nợ</button>'; toolbar.appendChild(group); }
async function openAnalyticsReport(type) { const from = document.getElementById('analyticsFrom')?.value; const to = document.getElementById('analyticsTo')?.value; if (!from || !to || from > to) return toast('Khoảng ngày báo cáo không hợp lệ'); const titles = { REVENUE: 'Doanh thu', INVENTORY: 'Tồn kho', DEBT: 'Công nợ' }; try { const rows = await ipcRenderer.invoke('pos:analytics:detail', type, from, to); const columns = type === 'REVENUE' ? ['Mã HĐ', 'Thời gian', 'Khách hàng', 'Thu ngân', 'Thanh toán', 'Tổng tiền'] : type === 'INVENTORY' ? ['Mã hàng', 'Tên hàng', 'Danh mục', 'Tồn kho', 'Giá vốn', 'Giá trị tồn'] : ['Mã khách', 'Khách hàng', 'Điện thoại', 'Hạn mức', 'Công nợ']; const totalRevenue = type === 'REVENUE' ? rows.reduce((sum, row) => sum + Number(row.grand_total || 0), 0) : 0; const totalInventory = type === 'INVENTORY' ? rows.reduce((sum, row) => sum + Number(row.stock_value || 0), 0) : 0; const totalDebt = type === 'DEBT' ? rows.reduce((sum, row) => sum + Number(row.credit_balance || 0), 0) : 0; const bodyRows = rows.map((row) => type === 'REVENUE' ? [row.id, new Date(row.check_out_time).toLocaleString('vi-VN'), row.customer_name || 'Vãng lai', row.cashier_name || '-', paymentLabel((row.payment_method || 'OTHER').split(':')[0]), money(row.grand_total)] : type === 'INVENTORY' ? [row.id, row.name, row.category_name || '-', `${row.stock_quantity} ${row.unit}`, money(row.cost_price), money(row.stock_value)] : [row.code, row.full_name, row.phone || '-', money(row.credit_limit), money(row.credit_balance)]); const summary = type === 'REVENUE' ? `<div class="report-total-summary"><span>Tổng doanh thu</span><strong>${money(totalRevenue)}</strong></div>` : type === 'INVENTORY' ? `<div class="report-total-summary"><span>Tổng giá trị tồn kho</span><strong>${money(totalInventory)}</strong></div>` : `<div class="report-total-summary"><span>Tổng công nợ</span><strong>${money(totalDebt)}</strong></div>`; const overlay = document.createElement('div'); overlay.className = 'modal-overlay analytics-report-overlay'; overlay.style.display = 'flex'; overlay.innerHTML = `<div class="modal-card analytics-report-modal"><div class="modal-header"><h3><i class="fa-solid fa-chart-column"></i> Báo cáo ${titles[type]}</h3><button class="close-modal" type="button">&times;</button></div><div class="modal-body"><p class="report-range">Từ ${from} đến ${to}</p>${summary}<div class="report-table-scroll"><table class="inv-modern-table"><thead><tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${bodyRows.length ? bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}">Chưa có dữ liệu</td></tr>`}</tbody></table></div></div><div class="modal-footer"><button class="btn btn-outline" type="button" data-export>Xuất file CSV</button><button class="btn btn-primary" type="button" data-print>In báo cáo</button></div></div>`; document.body.appendChild(overlay); overlay.querySelector('.close-modal').onclick = () => overlay.remove(); overlay.querySelector('[data-export]').onclick = async () => { try { const exportHeaders = type === 'REVENUE' ? ['Tổng doanh thu', ...columns] : type === 'INVENTORY' ? ['Tổng giá trị tồn kho', ...columns] : ['Tổng công nợ', ...columns]; const exportRows = type === 'REVENUE' ? [[money(totalRevenue)], ...bodyRows.map((row) => ['', ...row])] : type === 'INVENTORY' ? [[money(totalInventory)], ...bodyRows.map((row) => ['', ...row])] : [[money(totalDebt)], ...bodyRows.map((row) => ['', ...row])]; const result = await ipcRenderer.invoke('pos:analytics:export', titles[type], exportHeaders, exportRows); if (!result.canceled) toast(`Đã xuất báo cáo: ${result.file}`); } catch (error) { toast(`Xuất báo cáo thất bại: ${error.message}`); } }; overlay.querySelector('[data-print]').onclick = async () => { try { await ipcRenderer.invoke('pos:report:print', titles[type], from, to, 'A4'); await processPrintJobs(); toast(`Đã gửi báo cáo ${titles[type]} đến máy in`); } catch (error) { toast(`In báo cáo thất bại: ${error.message}`); } }; } catch (error) { toast(`Không tải được báo cáo: ${error.message}`); } }
window.addEventListener('DOMContentLoaded', () => {
  setupWindowControls(); setupClock(); setupNavigation(); setupSettingsNavigation(); setupShortcuts(); setupSearch(); setupInventory(); setupAnalytics(); setupPaymentMethods(); setupAuthentication(); bootstrap();
  document.getElementById('customerForm')?.addEventListener('submit', saveCustomer);
  document.getElementById('customerSearchInput')?.addEventListener('input', loadCustomers);
  document.getElementById('customerTierFilter')?.addEventListener('change', loadCustomers);
  document.getElementById('paymentCustomerSearch')?.addEventListener('input', loadPaymentCustomers);
  document.getElementById('paymentQuickCreateButton')?.addEventListener('click', openQuickCustomerModal);
  document.getElementById('paymentCustomerSelect')?.addEventListener('change', updatePaymentCustomerSummary);
  document.getElementById('productForm')?.addEventListener('reset', () => { document.getElementById('prodCode').disabled = false; });
  window.addEventListener('focus', refreshLicenseEnforcement);
  setInterval(refreshLicenseEnforcement, 60000);
  setInterval(checkTakeawayOrders, 3000);
  setInterval(async () => {
    if (!currentSession) return;
    try { tables = await ipcRenderer.invoke('pos:tables'); renderFloorGrid(); } catch (error) { /* Mất kết nối local không làm sập giao diện. */ }
  }, 30000);

  ipcRenderer.on('pos:webhook:paid', (_event, data) => {
    toast(`🎉 Đã nhận chuyển khoản tự động cho đơn #${data.orderId.slice(-6)} (${money(data.amount)})!`);
    closePaymentModal();
    currentOrder = null;
    document.getElementById('currentTableDisplay').innerText = 'Chưa mở bàn';
    renderOrderTable();
    ipcRenderer.invoke('pos:tables').then((t) => { tables = t; renderFloorGrid(); });
    checkTakeawayOrders();
  });
});
async function checkTakeawayOrders() {
  if (!currentSession) return;
  try {
    const openOrders = await ipcRenderer.invoke('pos:orders:list-open');
    const takeaways = (openOrders || []).filter((o) => (!o.table_id || o.table_id === '') && o.status === 'SERVING' && o.id !== currentOrder?.id);
    const banner = document.getElementById('takeawayNoticeBanner');
    if (banner) {
      if (takeaways.length > 0) {
        banner.style.display = 'flex';
        banner.innerHTML = `<span><i class="fa-solid fa-bag-shopping"></i> Có <strong>${takeaways.length} đơn mang đi</strong> từ NinoOrder chưa thanh toán</span> <button class="takeaway-pay-btn" type="button" onclick="openTakeawayModal()">Chọn đơn thanh toán</button>`;
      } else {
        banner.style.display = 'none';
      }
    }
  } catch (_) {}
}

async function openTakeawayModal() {
  try {
    const openOrders = await ipcRenderer.invoke('pos:orders:list-open');
    const takeaways = (openOrders || []).filter((o) => (!o.table_id || o.table_id === '') && o.status === 'SERVING' && o.id !== currentOrder?.id);
    const listEl = document.getElementById('takeawayOrdersList');
    if (listEl) {
      listEl.innerHTML = takeaways.map((order) => `
        <div class="takeaway-order-card">
          <div class="takeaway-order-info">
            <strong>Đơn #${order.id.slice(-6)} (${order.user_id || 'Nhân viên'})</strong>
            <small>Thời gian: ${new Date(order.check_in_time).toLocaleTimeString('vi-VN')} • Tổng tiền: <strong style="color: #16a34a">${money(order.grand_total)}</strong></small>
          </div>
          <button class="btn btn-success btn-sm" type="button" onclick="selectTakeawayOrder('${order.id}'); closeTakeawayModal();">Chọn thanh toán</button>
        </div>
      `).join('') || '<div class="text-center text-muted py-3">Không có đơn mang đi nào đang chờ.</div>';
    }
    document.getElementById('takeawayModal').style.display = 'flex';
  } catch (err) {
    toast(`Không tải được danh sách đơn mang đi: ${err.message}`);
  }
}

function closeTakeawayModal() {
  document.getElementById('takeawayModal').style.display = 'none';
}

async function selectTakeawayOrder(orderId) {
  try {
    currentOrder = await ipcRenderer.invoke('pos:orders:get', orderId);
    if (!currentOrder) throw new Error('Không tìm thấy đơn hàng.');
    document.getElementById('currentTableDisplay').innerText = `Đơn mang đi #${currentOrder.id.slice(-6)}`;
    renderOrderTable();
    toast(`Đã nạp đơn mang đi #${currentOrder.id.slice(-6)} để thanh toán`);
  } catch (err) {
    toast(`Không nạp được đơn: ${err.message}`);
  }
}
function openBillPreview() {
  closeBillPreview();
  const editor = document.getElementById('configBillHtmlTemplate');
  if (!editor) return toast('Chưa tải được trình sửa bill K80.');
  const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const values = { '{{store.name}}': escape(appSettings['store.name'] || 'NinoPOS'), '{{store.address}}': escape(appSettings['store.address'] || '123 Đường Mẫu'), '{{store.phone}}': escape(appSettings['store.phone'] || '0900 000 000'), '{{title}}': 'PHIẾU THANH TOÁN', '{{order.id}}': 'HD-DEMO-001', '{{order.table}}': 'Bàn 01', '{{order.date}}': new Date().toLocaleDateString('vi-VN'), '{{order.time}}': new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), '{{items}}': '<tr><td>Cafe Muối Quy Nhơn</td><td>2</td><td>60.000</td></tr><tr><td>Bánh ngọt</td><td>1</td><td>25.000</td></tr>', '{{subtotal}}': '85.000', '{{vat}}': '6.800', '{{total}}': '91.800', '{{qr}}': '', '{{footer}}': escape(document.getElementById('configPrinterBillFooter')?.value || 'Cảm ơn Quý khách!') };
  const content = Object.entries(values).reduce((html, [key, value]) => html.replaceAll(key, value), editor.innerHTML);
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.id = 'billPreviewOverlay'; overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="modal-card bill-preview-modal"><div class="modal-header"><h3><i class="fa-solid fa-eye"></i> Xem trước Bill K80</h3><button class="close-modal" type="button" id="closeBillPreviewButton">&times;</button></div><div class="modal-body"><div class="bill-html-editor bill-preview-render">${content}</div></div><div class="modal-footer"><button class="btn btn-secondary" type="button" id="closeBillPreviewFooterButton">Đóng</button></div></div>`;
  document.body.appendChild(overlay); overlay.querySelector('#closeBillPreviewButton').addEventListener('click', closeBillPreview); overlay.querySelector('#closeBillPreviewFooterButton').addEventListener('click', closeBillPreview);
}
