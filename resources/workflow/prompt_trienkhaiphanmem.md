# VAI TRÒ (ROLE)
Bạn là một Senior Fullstack Desktop Software Architect kiêm Chuyên gia phát triển giải pháp F&B POS tại Việt Nam.
Nhiệm vụ của bạn là tiếp quản bộ giao diện đã hoàn thiện (HTML/CSS/JS chạy trên nền Electron / Windows Desktop) và triển khai toàn bộ mã nguồn Backend, Business Logic, Local Database và Tích hợp phần cứng để tạo thành phần mềm tính tiền chạy offline-first hoàn chỉnh: NinoPOS.

---

# MỤC TIÊU & CÔNG NGHỆ CHỦ ĐẠO (TECH STACK)
- Nền tảng: Electron (Node.js) chạy trên Windows (Win 10/11 x64).
- Database: SQLite (sử dụng thư viện `better-sqlite3` để đảm bảo tốc độ cực nhanh, lưu trữ cục bộ 100%, không cần kết nối internet).
- Giao tiếp phần cứng: Hỗ trợ lệnh in nhiệt ESC/POS (qua cổng LAN/USB) cho máy in hóa đơn K80 và mở ngăn kéo đựng tiền RJ11.
- Kiến trúc: IPC (Inter-Process Communication) giữa Electron Main Process (`main.js`) và Renderer Process (`app.js`), chia nhỏ Controller/Service logic theo mô hình Modular.

---

# CƠ SỞ DỮ LIỆU CỤC BỘ (SQLITE SCHEMA)
Hãy viết mã tự động khởi tạo file database `pos_data.db` và chạy migration cho các bảng sau:

1. `users` (Nhân viên): `id`, `username`, `password_hash`, `full_name`, `role` (ADMIN, CASHIER, WAITER), `pin_code` (4-6 số để mở khóa ca), `status`, `created_at`.
2. `areas` (Khu vực): `id`, `name` (Sân vườn, Tầng 1, VIP...), `sort_order`.
3. `tables` (Bàn): `id`, `area_id`, `name`, `status` (EMPTY, OCCUPIED, WAITING_PAYMENT, RESERVED), `active_order_id`, `current_guest_count`.
4. `categories` (Danh mục): `id`, `name`, `icon`, `sort_order`.
5. `products` (Món ăn/Thực đơn): `id`, `category_id`, `name`, `cost_price` (giá vốn), `selling_price` (giá bán), `unit` (Đĩa, Lon, Nồi, Kg), `stock_quantity`, `is_weighted` (0/1 - món cân ký), `status`.
6. `orders` (Hóa đơn/Đơn bàn): `id`, `table_id`, `user_id`, `check_in_time`, `check_out_time`, `subtotal`, `discount_type` (PERCENT/AMOUNT), `discount_val`, `vat_rate` (8%), `vat_amount`, `grand_total`, `payment_method` (CASH, VIETQR, CARD), `customer_paid`, `change_amount`, `status` (SERVING, PAID, CANCELLED), `note`.
7. `order_details` (Chi tiết món gọi): `id`, `order_id`, `product_id`, `product_name`, `quantity`, `price`, `amount`, `is_printed_kitchen` (0/1), `note` (ít cay, không đường...).
8. `shifts` (Quản lý ca làm việc): `id`, `user_id`, `start_time`, `end_time`, `initial_cash` (tiền đầu ca), `total_cash_sales`, `total_qr_sales`, `total_card_sales`, `closing_cash` (tiền kiểm đếm cuối ca), `status` (OPEN, CLOSED).
9. `system_settings` (Cấu hình hệ thống): Key-Value store (Tên quán, Địa chỉ, Hotline, VAT mặc định, Cấu hình máy in bill K80, Cấu hình ngân hàng VietQR, Phím tắt).

---

# CHI TIẾT CÁC PHÂN HỆ NGHIỆP VỤ CẦN VIẾT CODE

## 1. Cấu hình Mặt bằng & Sơ đồ bàn (Floor Layout Engine)
- CRUD Khu vực và Bàn (Thêm, Sửa tên, Đổi khu vực, Xóa bàn không có khách).
- Hiển thị trực quan trạng thái bàn theo thời gian thực (Trống, Đang ngồi kèm đồng hồ đếm giờ vào, Chờ in bill).
- Bấm vào bàn trống -> Mở ngay màn hình POS để tạo Order mới cho bàn đó. Bấm vào bàn đang có khách -> Nạp giỏ hàng hiện tại của bàn lên màn hình tính tiền.

## 2. Quản lý Menu & Nhập liệu kho (Menu & Inventory Logic)
- Thêm/Sửa/Xóa món ăn, hỗ trợ import/export danh sách món bằng file Excel/CSV.
- Quản lý đơn vị tính, giá vốn, giá bán.
- Cảnh báo hoặc trừ tồn kho tự động khi hoàn tất thanh toán hóa đơn.
- Hỗ trợ món tính theo trọng lượng (cân đĩa/hải sản theo lạng, kg).

## 3. Bán hàng & Order tại bàn (POS Core Engine)
- Tìm kiếm món cực nhanh bằng phím F1 (theo tên, mã viết tắt, quét barcode).
- Thêm món vào đơn: Tự động cộng dồn nếu món đã tồn tại; tăng giảm số lượng trực tiếp (+/-), thêm ghi chú cho bếp (không hành, ít đường...).
- Hỗ trợ phân quyền trạng thái món: Món mới thêm -> Đánh dấu gửi bếp (F7); sau khi gửi bếp sẽ khóa không cho nhân viên thường tự ý xóa trừ khi có mật khẩu Admin/Hủy món.

## 4. Nghiệp vụ Bàn nâng cao (Chuyển bàn & Gộp bàn)
- **Chuyển bàn (Move Table):** Chuyển toàn bộ món từ Bàn A sang Bàn B (nếu Bàn B đang trống), cập nhật trạng thái Bàn A thành EMPTY và Bàn B thành OCCUPIED.
- **Gộp bàn (Merge Tables):** Gộp các món từ Bàn A vào Bàn B (nếu cả 2 bàn đều đang có khách), cộng dồn số lượng các món trùng nhau, đóng Bàn A và giữ lại Bàn B với tổng bill mới.
- Lưu vết lịch sử chuyển/gộp bàn vào đơn hàng để tránh thất thoát, gian lận.

## 5. Thanh toán & Tính tiền (Checkout & Payment Gateway)
- **Tạm tính (F8):** Lệnh in phiếu tạm tính ra máy in K80 để nhân viên mang ra bàn cho khách kiểm bill trước.
- **Thanh toán Tiền mặt (Cash):** Hỗ trợ gợi ý phím tiền tệ (100k, 200k, 500k, Đủ tiền), tự động tính tiền thối lại cho khách.
- **Thanh toán VietQR động:** Tạo chuỗi VietQR chuẩn NAPAS 247 theo cú pháp tài khoản ngân hàng trong bảng settings (nhúng đúng số tiền cần thanh toán và nội dung mã đơn hàng/số bàn).
- **Thanh toán thẻ/Ví:** Ghi nhận trace number và hoàn tất hóa đơn.
- **Xác nhận thanh toán:** Cập nhật trạng thái đơn thành PAID, đổi trạng thái bàn thành EMPTY, kích hoạt mở két tiền RJ11 và gửi lệnh in bill chính thức.

## 6. Quản lý Nhân viên & Ca làm việc (Shifts & Auth)
- Đăng nhập bằng tài khoản hoặc mã PIN nhanh (4-6 số).
- Phân quyền RBAC chặt chẽ:
  - `ADMIN`: Toàn quyền xem báo cáo, chỉnh sửa giá, cấu hình hệ thống, hủy món.
  - `CASHIER` (Thu ngân): Tạo đơn, tính tiền, in bill, không được đổi giá hoặc xóa bill đã thanh toán.
  - `WAITER` (Phục vụ): Chỉ được order món và chuyển bàn.
- Mở ca (Khai báo tiền đầu ca) và Đóng ca/Giao ca (Báo cáo doanh thu tiền mặt, QR, quẹt thẻ trong ca; cảnh báo chênh lệch tiền mặt thực tế).

## 7. Cấu hình Hệ thống & Thiết bị ngoại vi (Hardware & System Settings)
- Tích hợp driver máy in nhiệt K80 qua socket TCP/IP (máy in mạng LAN) hoặc USB/COM. Tạo mẫu in bill chuẩn đẹp (Header thông tin quán, bảng món rõ ràng, mã QR, lời cảm ơn).
- Cấu hình kích xung mở két tiền qua cổng RJ11 máy in (mã hex ESC/POS: `\x1b\x70\x00\x19\xfa`).
- Bắt và xử lý hệ thống phím tắt Windows toàn diện: `F1` (Tìm kiếm), `F2` (Menu), `F7` (Báo bếp), `F8` (Tạm tính), `F9` (Thanh toán), `F10` (Mở két), `Esc` (Đóng cửa sổ).

---

# YÊU CẦU ĐẦU RA (OUTPUT REQUIREMENTS)
1. Cung cấp cấu trúc thư mục dự án chuẩn cho Electron + SQLite.
2. Viết mã nguồn hoàn chỉnh cho file khởi tạo database và các hàm truy vấn (Database Helper / Repository).
3. Viết mã nguồn Electron IPC handlers (`main.js` hoặc file service riêng) xử lý từng hành động (CRUD bàn, CRUD món, Xử lý Order, Chuyển/Gộp bàn, Thanh toán, In ấn).
4. Cập nhật mã nguồn `app.js` phía Client để kết nối với các IPC channels thay vì dùng mảng dữ liệu mẫu (mock data).
5. Code phải có comment giải thích rõ ràng bằng tiếng Việt, có cơ chế bắt lỗi `try...catch` cẩn thận để ứng dụng Windows không bị crash khi mất kết nối máy in hoặc lỗi dữ liệu.

Hãy bắt đầu bằng việc thiết kế cấu trúc thư mục và viết file khởi tạo Database cùng các hàm xử lý nghiệp vụ cốt lõi.