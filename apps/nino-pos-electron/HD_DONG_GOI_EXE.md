# NinoPOS - Bộ Giao Diện & Mã Nguồn Cho Ứng Dụng Windows (.EXE)

Đây là bộ mã nguồn giao diện hoàn chỉnh (Full UI & Logic POS F&B) dành cho ứng dụng chạy trên Windows Desktop: Nhà hàng, Quán nhậu, Cafe.

## Cấu trúc thư mục:
- `index.html`: Giao diện ứng dụng toàn diện (Màn hình POS 3 cột, Sơ đồ bàn, Nhập kho/mặt hàng, Báo cáo doanh thu, Cấu hình máy in, Pop-up thanh toán VietQR đa phương thức).
- `style.css`: Bộ giao diện hiện đại Windows Fluent/Metro Dark-Navy & Light POS Theme tối ưu cho thao tác Cảm ứng hoặc Chuột & Phím.
- `app.js`: Động cơ xử lý nghiệp vụ bán hàng, tính tiền, phím tắt F1-F12, chuyển bàn, cập nhật giỏ hàng.
- `main.js` & `package.json`: Cấu hình nền tảng Electron để đóng gói thành tệp chạy trực tiếp `.exe`.

## Cách chạy thử hoặc đóng gói ra file .EXE:
1. **Chạy ngay lập tức:** Nhấp đúp mở trực tiếp tệp `index.html` bằng bất kỳ trình duyệt nào (Edge, Chrome) để trải nghiệm toàn bộ giao diện và nghiệp vụ.
2. **Đóng gói thành file NinoPOS.exe:**
   - Cài đặt [Node.js](https://nodejs.org/).
   - Mở Terminal/CMD tại thư mục này và chạy:
     ```bash
     npm install
     npm run build:win
     ```
   - Thư mục `dist/NinoPOS-win32-x64/` sẽ chứa file `NinoPOS.exe` để cài đặt và phân phối cho khách hàng.
