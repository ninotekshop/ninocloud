const { ipcRenderer } = require('electron');

let currentPin = '';
let targetUser = { id: 'admin', name: 'Lê Trung Hiếu (Admin)', pin: '1234' };

const usersMap = {
  admin: { id: 'admin', name: 'Lê Trung Hiếu (Admin)', pin: '1234' },
  cashier: { id: 'cashier', name: 'Trần Thị Thu Ngân (Thu Ngân)', pin: '1111' },
  waiter: { id: 'waiter', name: 'Lê Văn Phục Vụ', pin: '2222' }
};

document.addEventListener('DOMContentLoaded', () => {
  setupKeyboardListener();
});

function switchLoginMode(mode) {
  const tabPin = document.getElementById('tabPin');
  const tabAccount = document.getElementById('tabAccount');
  const viewPin = document.getElementById('viewPin');
  const viewAccount = document.getElementById('viewAccount');

  if (mode === 'pin') {
    tabPin.classList.add('active');
    tabAccount.classList.remove('active');
    viewPin.classList.add('active');
    viewAccount.classList.remove('active');
    clearPin();
  } else {
    tabAccount.classList.add('active');
    tabPin.classList.remove('active');
    viewAccount.classList.add('active');
    viewPin.classList.remove('active');
  }
}

function selectQuickUser(userId, userName) {
  document.querySelectorAll('.user-avatar-pill').forEach(pill => pill.classList.remove('active'));
  event.currentTarget.classList.add('active');
  targetUser = usersMap[userId] || { id: userId, name: userName, pin: '1234' };
  document.getElementById('currentPinUser').innerHTML = `Đang đăng nhập: <strong>${targetUser.name}</strong>`;
  clearPin();
}

function pressNumpad(digit) {
  if (currentPin.length < 4) {
    currentPin += digit;
    updatePinDots();
    if (currentPin.length === 4) {
      verifyPin();
    }
  }
}

function backspacePin() {
  currentPin = currentPin.slice(0, -1);
  updatePinDots();
}

function clearPin() {
  currentPin = '';
  updatePinDots();
}

function updatePinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, index) => {
    if (index < currentPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

async function verifyPin() {
  try {
    await ipcRenderer.invoke('pos:auth:pin', currentPin, targetUser.id);
    showToast(`✓ Xác thực thành công cho ${targetUser.name}.`);
    setTimeout(() => { window.location.href = 'pos.html'; }, 500);
  } catch (error) {
    showToast(`⚠️ Đăng nhập thất bại: ${error.message}`);
    const container = document.getElementById('pinDots');
    container.style.animation = 'shake 0.3s';
    setTimeout(() => {
      container.style.animation = '';
      clearPin();
    }, 400);
  }
}

function setupKeyboardListener() {
  window.addEventListener('keydown', (e) => {
    // Only process numpad when PIN tab is active
    if (document.getElementById('viewPin').classList.contains('active')) {
      if (e.key >= '0' && e.key <= '9') {
        pressNumpad(e.key);
      } else if (e.key === 'Backspace') {
        backspacePin();
      } else if (e.key === 'Escape') {
        clearPin();
      }
    }
  });
}

async function handleAccountLogin(e) {
  e.preventDefault();
  const u = document.getElementById('usernameInput').value.trim();
  const p = document.getElementById('passwordInput').value.trim();

  try {
    const session = await ipcRenderer.invoke('pos:auth:login', u, p);
    if (session) {
      showToast(`✓ Đăng nhập thành công! Chào mừng ${session.full_name}.`);
      setTimeout(() => { window.location.href = 'pos.html'; }, 500);
    }
  } catch (error) {
    showToast(`⚠️ Đăng nhập thất bại: ${error.message}`);
  }
}

function openApplication() {
  window.location.href = 'pos.html';
}

function togglePasswordVisibility() {
  const input = document.getElementById('passwordInput');
  const icon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2400);
}
