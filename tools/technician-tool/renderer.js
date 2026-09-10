const { ipcRenderer } = require('electron');
const authPanel = document.getElementById('authPanel');
const toolPanel = document.getElementById('toolPanel');
const message = document.getElementById('authMessage');
const toolMessage = document.getElementById('toolMessage');
const usersBody = document.getElementById('usersBody');

function showMessage(target, text, error = false) { target.textContent = text; target.className = `message ${error ? 'error' : 'success'}`; }
async function loadUsers() {
  const users = await ipcRenderer.invoke('technician:users');
  usersBody.innerHTML = users.map((user) => `<tr><td>${user.full_name}</td><td>${user.username}</td><td>${user.role}</td><td>${user.status}</td><td>${new Date(user.created_at).toLocaleString('vi-VN')}</td></tr>`).join('');
}
document.getElementById('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await ipcRenderer.invoke('technician:authenticate', document.getElementById('technicianKey').value); authPanel.hidden = true; toolPanel.hidden = false; await loadUsers(); }
  catch (error) { showMessage(message, error.message, true); }
});
document.getElementById('generateButton').addEventListener('click', async () => {
  try { const code = await ipcRenderer.invoke('technician:generate-admin-recovery'); document.getElementById('recoveryCode').textContent = code; document.getElementById('recoveryBox').hidden = false; await navigator.clipboard.writeText(code); showMessage(toolMessage, 'Đã tạo và sao chép mã reset. Không gửi mã qua kênh không an toàn.'); }
  catch (error) { showMessage(toolMessage, error.message, true); }
});
document.getElementById('copyButton').addEventListener('click', async () => { await navigator.clipboard.writeText(document.getElementById('recoveryCode').textContent); showMessage(toolMessage, 'Đã sao chép mã reset.'); });
